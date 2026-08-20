import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { AgentConversationRepository } from "@openengage/database/testing";

import { createSessionFixtureClient, seedMember, seedWorkspace } from "./factory";

describe("agent conversations", () => {
  it("creates and lists conversations only for the current session workspace and user", async () => {
    const owner = await seedWorkspace(env.DB);
    await seedMember(env.DB, owner);
    const { client } = await createSessionFixtureClient(env.DB, owner);

    const created = await client.agents.conversations.create({ agent: "hello" });
    expect(created).toMatchObject({ agent: "hello" });

    await expect(client.agents.conversations.list({ agent: "hello" })).resolves.toEqual([created]);

    const other = await seedWorkspace(env.DB);
    await seedMember(env.DB, other);
    const otherSession = await createSessionFixtureClient(env.DB, other);
    await expect(
      otherSession.client.agents.conversations.list({ agent: "hello" }),
    ).resolves.toEqual([]);
  });

  it("requires a Better Auth session and forwards only an owned conversation", async () => {
    const owner = await seedWorkspace(env.DB);
    await seedMember(env.DB, owner);
    const { cookie } = await createSessionFixtureClient(env.DB, owner);
    const conversation = await new AgentConversationRepository(env.DB).create({
      workspaceId: owner.workspaceId,
      ownerUserId: owner.userId,
      agentKey: "hello",
    });
    const url = `http://localhost:8787/api/agents/hello/${conversation.id}`;

    await expect(exports.default.fetch(url)).resolves.toMatchObject({ status: 401 });
    await expect(
      exports.default.fetch(url, { headers: { authorization: `Bearer ${owner.token}` } }),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      exports.default.fetch(url, {
        method: "POST",
        headers: { cookie, origin: "https://attacker.example" },
      }),
    ).resolves.toMatchObject({ status: 403 });

    const response = await exports.default.fetch(url, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: "must-not-reach-agent",
        cookie,
        origin: "http://localhost:8787",
        "x-openengage-workspace": owner.workspaceId,
      },
      body: "stream-body",
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-flue-stream")).toBe("preserved");
    expect(response.headers.get("x-agent-path")).toBe(`/api/agents/hello/${conversation.id}`);
    expect(response.headers.get("x-agent-authorization")).toBe("");
    expect(response.headers.get("x-agent-cookie")).toBe("");
    expect(response.headers.get("x-agent-workspace")).toBe("");
    await expect(response.text()).resolves.toBe("stream-body");
  });

  it("returns 404 for another user, a missing conversation, and unsupported surfaces", async () => {
    const owner = await seedWorkspace(env.DB);
    await seedMember(env.DB, owner);
    const conversation = await new AgentConversationRepository(env.DB).create({
      workspaceId: owner.workspaceId,
      ownerUserId: owner.userId,
      agentKey: "hello",
    });
    const other = await seedWorkspace(env.DB);
    await seedMember(env.DB, other);
    const { cookie } = await createSessionFixtureClient(env.DB, other);

    for (const path of [
      `/api/agents/hello/${conversation.id}`,
      "/api/agents/hello/01999999-9999-7999-8999-999999999999",
    ]) {
      const response = await exports.default.fetch(`http://localhost:8787${path}`, {
        headers: { cookie },
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("x-agent-path")).toBeNull();
    }

    const unsupported = await exports.default.fetch(
      `http://localhost:8787/api/agents/hello/${conversation.id}/admin`,
      { headers: { cookie } },
    );
    expect(unsupported.status).toBe(404);
  });
});
