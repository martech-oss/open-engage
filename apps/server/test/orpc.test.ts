import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { contract } from "@openengage/orpc";

import { seedWorkspace } from "./factory";

function createClient(token?: string): ContractRouterClient<typeof contract> {
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    fetch: (request) => exports.default.fetch(request),
  });
  return createORPCClient(link);
}

describe("oRPC API", () => {
  it("returns a typed authentication error without credentials", async () => {
    await expect(createClient().workspace.get()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      defined: true,
    });
  });

  it("gets a workspace and creates and lists contacts", async () => {
    const { workspaceId, token } = await seedWorkspace(env.DB, {
      name: "oRPC Workspace",
      timezone: "Asia/Tokyo",
    });

    const client = createClient(token);
    await expect(client.workspace.get()).resolves.toMatchObject({
      id: workspaceId,
      name: "oRPC Workspace",
      timezone: "Asia/Tokyo",
      role: "owner",
    });

    const created = await client.contacts.create({
      email: "orpc-contact@example.com",
      firstName: "RPC",
      stage: "lead",
      customFields: {},
    });
    expect(created).toMatchObject({
      email: "orpc-contact@example.com",
      firstName: "RPC",
      status: "active",
    });

    const page = await client.contacts.list({
      query: "orpc-contact@example.com",
      status: "active",
      limit: 20,
    });
    expect(page.total).toBe(1);
    expect(page.items).toEqual([
      expect.objectContaining({
        id: created.id,
        tags: [],
        companies: [],
      }),
    ]);

    await expect(
      client.contacts.create({
        email: "orpc-contact@example.com",
        customFields: {},
      }),
    ).rejects.toMatchObject({
      code: "CONTACT_CONFLICT",
      status: 409,
    });

    await expect(client.dashboard.get()).resolves.toMatchObject({
      contacts: { count: 1 },
    });

    const tagName = `oRPC tag ${workspaceId}`;
    await expect(
      client.contacts.createTag({ name: tagName, color: "#0f766e" }),
    ).resolves.toMatchObject({ name: tagName, color: "#0f766e" });

    // Email Service is configured only through Worker bindings. Provider
    // credentials must never be accepted or persisted through the API.
    const removedProviderConfig = await exports.default.fetch(
      new Request("http://localhost:8787/api/v1/providers/cloudflare", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          apiToken: "must_not_be_saved",
        }),
      }),
    );
    expect(removedProviderConfig.status).toBe(404);
    const storedProviderConfigs = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM provider_configs WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first<{ count: number }>();
    expect(storedProviderConfigs?.count).toBe(0);
  });
});
