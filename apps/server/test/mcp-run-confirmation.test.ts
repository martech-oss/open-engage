import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

import { seedWorkspaceClient } from "./factory";

async function call(token: string, name: string, args: Record<string, unknown>) {
  const response = await exports.default.fetch(
    new Request("http://localhost:8787/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { isError?: boolean; structuredContent?: Record<string, unknown> };
    error?: unknown;
  };
  expect(body.error).toBeUndefined();
  return body.result;
}

async function fixture() {
  const f = await seedWorkspaceClient(env.DB);
  const contact = await f.client.contacts.create({ email: "confirmed-batch@example.com" });
  const graph = {
    name: "Confirmed batch",
    nodes: [
      {
        id: "source",
        type: "source" as const,
        position: { x: 0, y: 0 },
        config: {
          source: "batch" as const,
          reentry: "every_time" as const,
          audience: {
            kind: "filter" as const,
            filter: {
              kind: "condition" as const,
              field: "score" as const,
              operator: "gte" as const,
              value: 0,
            },
          },
          schedule: { kind: "now" as const },
        },
      },
    ],
    edges: [],
  };
  const { id } = await f.client.automations.create(graph);
  const published = await f.client.automations.publish({ id });
  const prepare = async () => {
    const result = await call(f.token, "prepare_automation_run", { id });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      requiresConfirmation: true,
      automationId: id,
      count: 1,
      versionId: published.publishedVersionId,
    });
    const prepared = result.structuredContent!;
    expect(Date.parse(prepared.expiresAt as string) - Date.now()).toBeGreaterThan(4 * 60_000);
    return { confirmationToken: prepared.confirmationToken, confirmation: "CONFIRM SEND" };
  };
  return { ...f, id, graph, contact, published, prepare };
}

it("requires exact acknowledgement and scopes one-use batch confirmations to API key and workspace", async () => {
  const f = await fixture();
  const input = await f.prepare();
  const other = await seedWorkspaceClient(env.DB);
  const otherKey = await f.client.workspace.createApiKey({ name: "Other key", role: "owner" });
  for (const [token, args] of [
    [
      f.token,
      { id: f.id, versionId: f.published.publishedVersionId, requestId: "no-confirmation" },
    ],
    [f.token, { ...input, confirmation: "confirm send" }],
    [f.token, { confirmationToken: input.confirmationToken }],
    [other.token, input],
    [otherKey.token, input],
  ] as const)
    expect((await call(token, "start_automation_run", args)).isError).toBe(true);
  expect(await f.client.automations.listRuns({ id: f.id })).toHaveLength(0);
  const attempts = await Promise.all([
    call(f.token, "start_automation_run", input),
    call(f.token, "start_automation_run", input),
  ]);
  expect(attempts.filter((result) => !result.isError)).toHaveLength(1);
  expect(attempts.filter((result) => result.isError)).toHaveLength(1);
  const runs = await f.client.automations.listRuns({ id: f.id });
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({
    automationVersionId: f.published.publishedVersionId,
    targetCount: 1,
  });
  expect((await call(f.token, "start_automation_run", input)).isError).toBe(true);
});

it("rejects expired and stale-publication confirmations without starting a run", async () => {
  const f = await fixture();
  const expired = await f.prepare();
  await env.DB.prepare(
    "UPDATE idempotency_keys SET expires_at = ? WHERE workspace_id = ? AND idempotency_key = ?",
  )
    .bind(new Date(Date.now() - 1000).toISOString(), f.workspaceId, expired.confirmationToken)
    .run();
  expect((await call(f.token, "start_automation_run", expired)).isError).toBe(true);
  const stale = await f.prepare();
  await f.client.automations.saveDraft({ ...f.graph, id: f.id, name: "Changed publication" });
  await f.client.automations.publish({ id: f.id });
  expect(await call(f.token, "start_automation_run", stale)).toMatchObject({
    isError: true,
    structuredContent: { code: "INVALID_AUTOMATION_RUN" },
  });
  expect(await f.client.automations.listRuns({ id: f.id })).toHaveLength(0);
});

it("keeps role guards and prevents exchanging enrollment and batch tokens", async () => {
  const f = await fixture();
  const input = await f.prepare();
  const enrollment = await call(f.token, "prepare_automation_enrollment", {
    automationId: f.id,
    contactId: f.contact.id,
  });
  expect(enrollment.isError).not.toBe(true);
  expect(
    (
      await call(f.token, "start_automation_run", {
        ...input,
        confirmationToken: enrollment.structuredContent!.confirmationToken,
      })
    ).isError,
  ).toBe(true);
  expect((await call(f.token, "confirm_automation_enrollment", input)).isError).toBe(true);
  await env.DB.prepare("UPDATE api_keys SET role = 'viewer' WHERE workspace_id = ?")
    .bind(f.workspaceId)
    .run();
  expect(await call(f.token, "prepare_automation_run", { id: f.id })).toMatchObject({
    isError: true,
    structuredContent: { code: "FORBIDDEN" },
  });
  expect(await call(f.token, "start_automation_run", input)).toMatchObject({
    isError: true,
    structuredContent: { code: "FORBIDDEN" },
  });
  await env.DB.prepare("UPDATE api_keys SET role = 'owner' WHERE workspace_id = ?")
    .bind(f.workspaceId)
    .run();
  // Rejected callers must not consume the rightful owner's token.
  expect((await call(f.token, "start_automation_run", input)).isError).not.toBe(true);
});
