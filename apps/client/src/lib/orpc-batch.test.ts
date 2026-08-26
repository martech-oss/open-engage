import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL } from "@orpc/tanstack-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { contract } from "@openengage/orpc";

import { createRpcBatchPlugin, rpcRequestMethod } from "./orpc-batching";

const bindingFetch = vi.fn<(request: Request) => Promise<Response>>();

function createTestClient(): ContractRouterClient<typeof contract> {
  const link = new RPCLink({
    url: "https://client.example.test/api/rpc",
    method: ({ context }) => rpcRequestMethod(context),
    plugins: [createRpcBatchPlugin()],
    fetch: bindingFetch,
  });
  return createORPCClient(link);
}

const queryCallOptions = {
  context: {
    [TANSTACK_QUERY_OPERATION_CONTEXT_SYMBOL]: {
      key: ["batch-test"],
      type: "query" as const,
    },
  },
};

describe("oRPC GET batching", () => {
  beforeEach(() => {
    bindingFetch.mockReset();
    bindingFetch.mockImplementation(
      async () =>
        new Response("{}", {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
  });

  it("combines four concurrent editor GET queries into one binding request", async () => {
    const orpc = createTestClient();
    await Promise.all([
      orpc.automations.getDraft({ id: "automation-1" }, queryCallOptions).catch(() => undefined),
      orpc.automations.analytics({ id: "automation-1" }, queryCallOptions).catch(() => undefined),
      orpc.segments.options(undefined, queryCallOptions).catch(() => undefined),
      orpc.workspace.getEmailBrand(undefined, queryCallOptions).catch(() => undefined),
    ]);

    expect(bindingFetch).toHaveBeenCalledOnce();
    expect(new URL(bindingFetch.mock.calls[0]![0].url).pathname).toBe("/api/rpc/__batch__");
  });

  it("limits each GET batch to ten requests", async () => {
    const orpc = createTestClient();
    await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        orpc.automations
          .getDraft({ id: `automation-${index}` }, queryCallOptions)
          .catch(() => undefined),
      ),
    );

    expect(bindingFetch).toHaveBeenCalledTimes(2);
    for (const [request] of bindingFetch.mock.calls) {
      expect(new URL(request.url).pathname).toBe("/api/rpc/__batch__");
      expect(request.method).toBe("GET");
    }
  });

  it("does not batch mutations", async () => {
    const orpc = createTestClient();
    await Promise.all([
      orpc.contacts.create({ email: "first@example.com", customFields: {} }).catch(() => undefined),
      orpc.segments
        .create({ name: "Static", kind: "static", description: "" })
        .catch(() => undefined),
    ]);

    expect(bindingFetch).toHaveBeenCalledTimes(2);
    expect(
      bindingFetch.mock.calls.map(([request]) => new URL(request.url).pathname).sort(),
    ).toEqual(["/api/rpc/contacts/create", "/api/rpc/segments/create"]);
    expect(bindingFetch.mock.calls.every(([request]) => request.method === "POST")).toBe(true);
  });

  it("does not batch file downloads", async () => {
    const orpc = createTestClient();
    await Promise.all([
      orpc.assets.download({ id: "asset-1" }, queryCallOptions).catch(() => undefined),
      orpc.contacts.downloadExport({ id: "export-1" }, queryCallOptions).catch(() => undefined),
    ]);

    expect(bindingFetch).toHaveBeenCalledTimes(2);
    expect(bindingFetch.mock.calls.every(([request]) => !request.url.includes("/__batch__"))).toBe(
      true,
    );
  });
});
