import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { makeSignature } from "better-auth/crypto";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDatabase, session, user, uuidv7 } from "@openengage/database/testing";
import type { contract } from "@openengage/orpc";

import { seedWorkspaceClient } from "./factory";

const emptyContent = { schemaVersion: 1 as const, blocks: [] };
const rawSessionSentinels = {
  token: "session-sentinel-token-",
  ipAddress: "session-sentinel-ipAddress-203.0.113.77",
  userAgent: "session-sentinel-userAgent-boundary-probe",
} as const;

describe("workspace authority", () => {
  it("returns a session-safe app bootstrap without Better Auth session fields", async () => {
    const fixture = await sessionOnlyClient("http://localhost:8787");

    await expect(fixture.client.app.bootstrap()).resolves.toEqual({
      viewer: {
        id: fixture.userId,
        name: "Session Owner",
        email: `${fixture.userId}@example.com`,
      },
      workspace: null,
      workspaces: [],
    });

    const created = await fixture.client.workspace.create({ name: "Bootstrap Workspace" });
    const bootstrap = await fixture.client.app.bootstrap();
    expect(bootstrap.workspace).toMatchObject({ id: created.id, name: "Bootstrap Workspace" });
    expect(bootstrap.workspaces).toEqual([
      { id: created.id, name: "Bootstrap Workspace", slug: created.slug },
    ]);
    const serialized = JSON.stringify(bootstrap);
    for (const sentinel of Object.values(rawSessionSentinels)) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(serialized).not.toMatch(/"(?:token|ipAddress|userAgent)"/);
  });

  it("returns null instead of falling back when the active organization is invalid", async () => {
    const fixture = await sessionOnlyClient("http://localhost:8787");
    const created = await fixture.client.workspace.create({ name: "Valid Membership" });
    await createDatabase(env.DB)
      .orm.update(session)
      .set({ activeOrganizationId: "missing-active-organization" })
      .where(eq(session.id, fixture.sessionId));

    await expect(fixture.client.app.bootstrap()).resolves.toMatchObject({
      workspace: null,
      workspaces: [{ id: created.id, name: "Valid Membership", slug: created.slug }],
    });
  });

  it("does not allow API keys through app bootstrap", async () => {
    const apiKey = await seedWorkspaceClient(env.DB);

    await expect(apiKey.client.app.bootstrap()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it.each([
    ["owner", true, true, true, true],
    ["admin", true, true, true, true],
    ["marketer", true, true, false, false],
    ["analyst", true, false, false, false],
    ["viewer", false, false, false, false],
  ] as const)(
    "returns server-derived capabilities for %s",
    async (role, viewReports, manageMarketing, manageWorkspace, manageApiKeys) => {
      const { client } = await seedWorkspaceClient(env.DB, { role });
      await expect(client.workspace.get()).resolves.toMatchObject({
        role,
        capabilities: { viewReports, manageMarketing, manageWorkspace, manageApiKeys },
      });
    },
  );

  it("keeps server mutation guards authoritative", async () => {
    const { client } = await seedWorkspaceClient(env.DB, { role: "viewer" });
    await expect(client.workspace.createApiKey({ name: "forbidden" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("accepts the configured Origin and creates from a session without an active workspace", async () => {
    const fixture = await sessionOnlyClient("http://localhost:8787");
    const created = await fixture.client.workspace.create({ name: "日本語の会社" });

    expect(created.slug).toBe("workspace");
    await expect(fixture.client.workspace.get()).resolves.toMatchObject({
      id: created.id,
      role: "owner",
    });
    const stored = await createDatabase(env.DB).orm.query.session.findFirst({
      where: (row, { eq }) => eq(row.id, fixture.sessionId),
    });
    expect(stored?.activeOrganizationId).toBe(created.id);

    const collision = await fixture.client.workspace.create({ name: "日本語の会社" });
    expect(collision.slug).toBe("workspace-2");
  });

  it("does not allow API keys through session-only creation", async () => {
    const apiKey = await seedWorkspaceClient(env.DB);
    await expect(
      apiKey.client.workspace.create({ name: "API key workspace" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it.each([
    ["missing", null],
    ["mismatched", "https://evil.example.com"],
  ] as const)("rejects a %s Origin on session-only mutations", async (_case, origin) => {
    const fixture = await sessionOnlyClient(origin);
    await expect(
      fixture.client.workspace.create({ name: "Rejected origin" }),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH", status: 403 });
  });
});

describe("resource slug authority", () => {
  it("generates collision-safe segment slugs while preserving explicit conflicts", async () => {
    const { client } = await seedWorkspaceClient(env.DB, { role: "marketer" });
    const first = await client.segments.create({ name: "日本語", kind: "static" });
    const second = await client.segments.create({ name: "日本語", kind: "static" });
    expect([first.slug, second.slug]).toEqual(["segment", "segment-2"]);

    await expect(
      client.segments.create({ name: "Explicit", slug: " Segment_日本 ", kind: "static" }),
    ).rejects.toMatchObject({ code: "SEGMENT_CONFLICT", status: 409 });
    await expect(
      client.segments.update({
        id: second.id,
        name: "Second",
        slug: " Segment_日本 ",
        description: "",
        kind: "static",
        filter: null,
        membershipSource: "Manual selection",
      }),
    ).rejects.toMatchObject({ code: "SEGMENT_CONFLICT", status: 409 });
  });

  it("generates landing-page and signup-form slugs and keeps explicit conflicts typed", async () => {
    const { client } = await seedWorkspaceClient(env.DB, { role: "marketer" });
    const page = await client.website.createPage({ name: "日本語", content: emptyContent });
    await expect(
      client.website.createPage({
        name: "Duplicate",
        slug: " Landing Page_日本 ",
        content: emptyContent,
      }),
    ).rejects.toMatchObject({ code: "PAGE_SLUG_TAKEN", status: 409 });
    expect(page.id).toBeTruthy();
    const secondPage = await client.website.createPage({
      name: "Second page",
      content: emptyContent,
    });
    await expect(
      client.website.updatePage({
        id: secondPage.id,
        name: "Second page",
        slug: " Landing Page_日本 ",
        status: "draft",
        content: emptyContent,
      }),
    ).rejects.toMatchObject({ code: "PAGE_SLUG_TAKEN", status: 409 });

    const form = await client.website.createForm({
      name: "日本語",
      definition: {},
      allowedDomains: [],
      turnstileEnabled: false,
    });
    await expect(
      client.website.createForm({
        name: "Duplicate",
        slug: " Signup Form_日本 ",
        definition: {},
        allowedDomains: [],
        turnstileEnabled: false,
      }),
    ).rejects.toMatchObject({ code: "FORM_SLUG_TAKEN", status: 409 });
    expect(form.id).toBeTruthy();
    const secondForm = await client.website.createForm({
      name: "Second form",
      definition: {},
      allowedDomains: [],
      turnstileEnabled: false,
    });
    await expect(
      client.website.updateForm({
        id: secondForm.id,
        name: "Second form",
        slug: " Signup Form_日本 ",
        status: "draft",
        definition: {},
        allowedDomains: [],
        turnstileEnabled: false,
        successMessage: "ありがとうございます。",
      }),
    ).rejects.toMatchObject({ code: "FORM_SLUG_TAKEN", status: 409 });
  });
});

async function sessionOnlyClient(origin: string | null): Promise<{
  sessionId: string;
  userId: string;
  client: ContractRouterClient<typeof contract>;
}> {
  const userId = uuidv7();
  const sessionId = uuidv7();
  const token = `${rawSessionSentinels.token}${uuidv7()}`;
  const now = new Date();
  const orm = createDatabase(env.DB).orm;
  await orm.batch([
    orm.insert(user).values({
      id: userId,
      name: "Session Owner",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }),
    orm.insert(session).values({
      id: sessionId,
      token,
      userId,
      ipAddress: rawSessionSentinels.ipAddress,
      userAgent: rawSessionSentinels.userAgent,
      activeOrganizationId: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    }),
  ]);
  const signature = await makeSignature(token, "test-better-auth-secret-at-least-32-characters");
  const link = new RPCLink({
    url: "http://localhost:8787/api/rpc",
    headers: {
      cookie: `__Secure-openengage.session_token=${token}.${signature}`,
      ...(origin ? { origin } : {}),
    },
    fetch: (request) => exports.default.fetch(request),
  });
  return { sessionId, userId, client: createORPCClient(link) };
}
