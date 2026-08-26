import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { makeSignature } from "better-auth/crypto";
import { env, exports } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDatabase,
  member,
  organization,
  session,
  user,
  uuidv7,
} from "@openengage/database/testing";
import type { contract } from "@openengage/orpc";

import { requestContext } from "../src/auth/access";
import type { AppEnvironment } from "../src/env";
import { createOrpcRequestHandler } from "../src/orpc/handler";
import { seedWorkspace } from "./factory";

const accessMetrics = {
  apiKey: 0,
  sessionLookups: 0,
  memberships: 0,
};

describe("oRPC batch handler", () => {
  beforeEach(() => {
    accessMetrics.apiKey = 0;
    accessMetrics.sessionLookups = 0;
    accessMetrics.memberships = 0;
  });

  it("serves four GET procedures through one Worker binding request", async () => {
    const { token } = await seedWorkspace(env.DB, { name: "Batched Workspace" });
    const bindingFetch = vi.fn<(request: Request) => Promise<Response>>(createInstrumentedFetch());
    const link = new RPCLink({
      url: "http://localhost:8787/api/rpc",
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      plugins: [
        new BatchLinkPlugin({
          groups: [{ condition: ({ request }) => request.method === "GET", context: {} }],
          maxSize: 10,
          url: "http://localhost:8787/api/rpc/__batch__",
        }),
      ],
      fetch: bindingFetch,
    });
    const client: ContractRouterClient<typeof contract> = createORPCClient(link);

    const [workspace, automations, segments, dashboard] = await Promise.all([
      client.workspace.get(),
      client.automations.list(),
      client.segments.list({}),
      client.dashboard.get(),
    ]);

    expect(bindingFetch).toHaveBeenCalledOnce();
    expect(new URL(bindingFetch.mock.calls[0]![0].url).pathname).toBe("/api/rpc/__batch__");
    expect(workspace.name).toBe("Batched Workspace");
    expect(automations).toEqual([]);
    expect(segments).toEqual([]);
    expect(dashboard).toMatchObject({ contacts: { count: 0 }, automations: { count: 0 } });
    expect(accessMetrics).toMatchObject({
      apiKey: 1,
      sessionLookups: 0,
      memberships: 0,
    });
  });

  it("shares one session lookup with membership resolution in a mixed session batch", async () => {
    const cookie = await seedSessionWorkspace();
    const bindingFetch = vi.fn<(request: Request) => Promise<Response>>(createInstrumentedFetch());
    const link = new RPCLink({
      url: "http://localhost:8787/api/rpc",
      method: "GET",
      headers: { cookie },
      plugins: [
        new BatchLinkPlugin({
          groups: [{ condition: ({ request }) => request.method === "GET", context: {} }],
          maxSize: 10,
          url: "http://localhost:8787/api/rpc/__batch__",
        }),
      ],
      fetch: bindingFetch,
    });
    const client: ContractRouterClient<typeof contract> = createORPCClient(link);

    const results = await Promise.all([
      client.app.bootstrap(),
      client.workspace.get(),
      client.agents.conversations.list(),
      client.agents.conversations.list(),
    ]);

    expect(bindingFetch).toHaveBeenCalledOnce();
    expect(results[0]).toMatchObject({ viewer: { name: "Batch Session User" } });
    expect(results[1]).toMatchObject({ name: "Batch Session Workspace" });
    expect(results.slice(2)).toEqual([[], []]);
    expect(accessMetrics).toMatchObject({
      apiKey: 0,
      sessionLookups: 1,
      memberships: 1,
    });
  });

  it("rejects a POST mutation smuggled inside an outer GET batch", async () => {
    const { token } = await seedWorkspace(env.DB, { name: "Strict GET Workspace" });
    let mutationRequest: Request | undefined;
    const captureLink = new RPCLink({
      url: "http://localhost:8787/api/rpc",
      fetch: async (request) => {
        mutationRequest = request.clone();
        return Response.json({}, { status: 500 });
      },
    });
    const captureClient: ContractRouterClient<typeof contract> = createORPCClient(captureLink);
    await captureClient.segments
      .create({ name: "Must not exist", description: "", kind: "static" })
      .catch(() => undefined);
    if (!mutationRequest) throw new Error("mutation request was not captured");

    const batchUrl = new URL("http://localhost:8787/api/rpc/__batch__");
    batchUrl.searchParams.set(
      "batch",
      JSON.stringify([
        {
          method: mutationRequest.method,
          url: mutationRequest.url,
          headers: Object.fromEntries(mutationRequest.headers),
          body: await mutationRequest.json(),
        },
      ]),
    );
    const response = await exports.default.fetch(
      new Request(batchUrl, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-orpc-batch": "buffered",
        },
      }),
    );
    const body = await response.text();

    expect(body).toContain("METHOD_NOT_SUPPORTED");
    const client: ContractRouterClient<typeof contract> = createORPCClient(
      new RPCLink({
        url: "http://localhost:8787/api/rpc",
        headers: { authorization: `Bearer ${token}` },
        fetch: (request) => exports.default.fetch(request),
      }),
    );
    await expect(client.segments.list({})).resolves.toEqual([]);
  });
});

async function seedSessionWorkspace(): Promise<string> {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const token = `batch-session-${uuidv7()}`;
  const now = new Date();
  const orm = createDatabase(env.DB).orm;
  await orm.batch([
    orm.insert(user).values({
      id: userId,
      name: "Batch Session User",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(organization).values({
      id: workspaceId,
      name: "Batch Session Workspace",
      slug: `batch-session-${workspaceId}`,
      timezone: "UTC",
      createdAt: now,
    }),
    orm.insert(member).values({
      id: uuidv7(),
      organizationId: workspaceId,
      userId,
      role: "owner",
      createdAt: now,
    }),
    orm.insert(session).values({
      id: uuidv7(),
      token,
      userId,
      activeOrganizationId: workspaceId,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    }),
  ]);
  const signature = await makeSignature(token, "test-better-auth-secret-at-least-32-characters");
  return `__Secure-openengage.session_token=${token}.${signature}`;
}

function createInstrumentedFetch(): (request: Request) => Promise<Response> {
  const app = new Hono<AppEnvironment>();
  app.use("*", requestContext);
  app.use(
    "/api/rpc/*",
    createOrpcRequestHandler({
      onAccessResolution(event) {
        if (event === "apiKey") accessMetrics.apiKey += 1;
        if (event === "session") accessMetrics.sessionLookups += 1;
        if (event === "membership") accessMetrics.memberships += 1;
      },
    }),
  );
  return async (request) => {
    const background: Promise<unknown>[] = [];
    const executionContext = {
      waitUntil(promise: Promise<unknown>) {
        background.push(promise);
      },
      passThroughOnException() {},
    } as ExecutionContext;
    const response = await app.fetch(request, env, executionContext);
    await Promise.all(background);
    return response;
  };
}
