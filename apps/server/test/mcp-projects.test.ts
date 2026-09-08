import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { ProjectCloneRepository } from "@openengage/database/projects";

import { seedWorkspaceClient } from "./factory";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

async function request(token: string, method: string, params: Record<string, unknown>) {
  const response = await exports.default.fetch(
    new Request("http://localhost:8787/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { result: unknown; error?: unknown };
  expect(payload.error).toBeUndefined();
  return payload.result;
}

async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  return (await request(token, "tools/call", { name, arguments: args })) as ToolResult;
}

async function success(token: string, name: string, args: Record<string, unknown> = {}) {
  const result = await call(token, name, args);
  expect(result.isError).not.toBe(true);
  return result.structuredContent!;
}

describe("Remote MCP project and automation APIs", () => {
  it("advertises callable tools with the public version, confirmation and idempotency inputs", async () => {
    const { token } = await seedWorkspaceClient(env.DB);
    const { tools } = (await request(token, "tools/list", {})) as {
      tools: Array<{
        name: string;
        inputSchema: { properties: Record<string, unknown>; required?: string[] };
        annotations: { readOnlyHint: boolean; openWorldHint: boolean };
      }>;
    };
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_projects",
        "create_project",
        "get_project_program_catalog",
        "get_project_program",
        "save_project_program",
        "publish_project_program",
        "list_project_members",
        "mutate_project_member",
        "import_project_members",
        "get_project_member_history",
        "get_project_program_cohort",
        "bind_project_program_form",
        "list_project_variables",
        "save_project_variable",
        "delete_project_variable",
        "get_project_variable_uses",
        "preview_project_variable_impact",
        "preview_project_clone",
        "start_project_clone",
        "get_project_clone",
        "retry_project_clone",
        "list_project_clones",
        "get_automation_execution_options",
        "preview_automation_run",
        "start_automation_run",
        "list_automation_runs",
        "get_automation_run",
        "cancel_automation_run",
        "get_automation_enrollment",
        "list_automation_enrollments",
        "cancel_automation_enrollment",
        "create_automation",
        "get_automation_definition",
        "save_automation_draft",
        "publish_automation",
        "set_automation_status",
      ]),
    );
    const schema = (name: string) => tools.find((tool) => tool.name === name)!.inputSchema;
    expect(schema("save_project_program").required).toEqual(
      expect.arrayContaining(["id", "definition", "expectedRowVersion"]),
    );
    expect(schema("publish_project_program").required).toEqual(
      expect.arrayContaining(["id", "expectedRowVersion", "confirmed"]),
    );
    expect(schema("mutate_project_member").required).toEqual(
      expect.arrayContaining(["id", "contactId", "idempotencyKey"]),
    );
    expect(schema("start_project_clone").required).toEqual(
      expect.arrayContaining(["id", "jobId", "requestKey"]),
    );
    expect(schema("start_automation_run").required).toEqual(
      expect.arrayContaining(["id", "requestId", "versionId"]),
    );
    expect(schema("save_project_variable").required).toEqual(
      expect.arrayContaining(["key", "type", "value", "expectedRevision"]),
    );
    // The create contract is an intersection; it must still advertise its graph inputs.
    expect(schema("create_automation").properties).toHaveProperty("nodes");
    expect(schema("create_automation").properties).toHaveProperty("projectId");
    expect(
      tools.find((tool) => tool.name === "preview_project_clone")!.annotations.readOnlyHint,
    ).toBe(false);
    expect(
      tools.find((tool) => tool.name === "start_automation_run")!.annotations.openWorldHint,
    ).toBe(true);
  });

  it("writes through the real program API, preserving publication, conflicts, member retries and history", async () => {
    const { token, client } = await seedWorkspaceClient(env.DB);
    const created = await success(token, "create_project", { name: "MCP event" });
    const id = created.id as string;
    const contact = await client.contacts.create({ email: "mcp-member@example.com" });
    const definition = PROJECT_PROGRAM_TEMPLATES.event;
    expect(
      await success(token, "save_project_program", { id, definition, expectedRowVersion: 0 }),
    ).toMatchObject({ rowVersion: 1, publishedVersion: null });
    expect(
      (
        await call(token, "publish_project_program", {
          id,
          expectedRowVersion: 1,
          confirmed: false,
        })
      ).isError,
    ).toBe(true);
    expect(
      await success(token, "publish_project_program", {
        id,
        expectedRowVersion: 1,
        confirmed: true,
      }),
    ).toMatchObject({ publishedVersion: 1, rowVersion: 2 });
    expect(await client.projects.programGet({ id })).toMatchObject({
      program: { publishedVersion: 1, definition },
    });
    const stale = await call(token, "save_project_program", {
      id,
      definition,
      expectedRowVersion: 1,
    });
    expect(stale).toMatchObject({
      isError: true,
      structuredContent: { code: "PROGRAM_CONFLICT", status: 409 },
    });
    const mutation = {
      id,
      contactId: contact.id,
      statusId: "attended",
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: 0,
    };
    const first = await success(token, "mutate_project_member", mutation);
    expect(first).toMatchObject({
      duplicate: false,
      member: { statusId: "attended", definitionVersion: 1, revision: 1, source: "api" },
    });
    expect(first.eventIds).toHaveLength(2);
    expect(await success(token, "mutate_project_member", mutation)).toEqual({
      ...first,
      duplicate: true,
    });
    expect(await client.projects.memberHistory({ id, contactId: contact.id })).toHaveLength(1);
    expect(await success(token, "list_project_members", { id })).toMatchObject({
      total: 1,
      items: [{ member: { contactId: contact.id } }],
    });
    expect(
      await success(token, "get_project_member_history", { id, contactId: contact.id }),
    ).toMatchObject({ value: [{ statusId: "attended" }] });
    expect(
      await success(token, "get_project_program_cohort", {
        id,
        from: "2000-01-01T00:00:00.000Z",
        to: "2100-01-01T00:00:00.000Z",
        asOf: new Date().toISOString(),
      }),
    ).toMatchObject({ members: 1, succeeded: 1, rate: 1 });
    const csvContact = await client.contacts.create({ email: "mcp-csv@example.com" });
    expect(
      await success(token, "import_project_members", {
        id,
        csv: `contactId,statusId\n${csvContact.id},registered\nunknown,registered`,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ rows: [{ ok: true, contactId: csvContact.id }, { ok: false }] });
    expect(await client.projects.memberList({ id })).toMatchObject({ total: 2 });
  });

  it("keeps role guards, workspace isolation and contract validation on MCP calls", async () => {
    const owner = await seedWorkspaceClient(env.DB);
    const other = await seedWorkspaceClient(env.DB);
    const project = await owner.client.projects.create({ name: "Private program" });
    const input = {
      id: project.id,
      definition: PROJECT_PROGRAM_TEMPLATES.inquiry,
      expectedRowVersion: 0,
    };
    await owner.client.projects.programSave(input);
    await owner.client.projects.programPublish({
      id: project.id,
      expectedRowVersion: 1,
      confirmed: true,
    });
    const foreignContact = await other.client.contacts.create({ email: "foreign@example.com" });
    for (const [token, name, args] of [
      [other.token, "get_project_program", { id: project.id }],
      [other.token, "save_project_program", { ...input, expectedRowVersion: 2 }],
      [
        owner.token,
        "mutate_project_member",
        { id: project.id, contactId: foreignContact.id, idempotencyKey: crypto.randomUUID() },
      ],
    ] as const) {
      expect(await call(token, name, args)).toMatchObject({
        isError: true,
        structuredContent: { code: "PROGRAM_NOT_FOUND", status: 404 },
      });
    }
    const invalid = await call(owner.token, "save_project_program", {
      ...input,
      expectedRowVersion: 2,
      definition: { ...input.definition, initialStatusId: "missing" },
    });
    expect(invalid.isError).toBe(true);
    expect(await owner.client.projects.programGet({ id: project.id })).toMatchObject({
      program: { rowVersion: 2 },
    });
    // Downgrade the key in the same workspace: a missing resource cannot mask the role guard.
    await env.DB.prepare("UPDATE api_keys SET role = 'viewer' WHERE workspace_id = ?")
      .bind(owner.workspaceId)
      .run();
    expect(await success(owner.token, "get_project_program", { id: project.id })).toMatchObject({
      allowedActions: { editDefinition: false },
    });
    expect(
      await call(owner.token, "save_project_program", { ...input, expectedRowVersion: 2 }),
    ).toMatchObject({ isError: true, structuredContent: { code: "FORBIDDEN", status: 403 } });
    expect(
      await call(owner.token, "mutate_project_member", {
        id: project.id,
        contactId: foreignContact.id,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ isError: true, structuredContent: { code: "FORBIDDEN", status: 403 } });
  });

  it("uses variable revisions and freezes a clone preview for idempotent starts", async () => {
    const { token, client, workspaceId } = await seedWorkspaceClient(env.DB);
    const { id } = await client.projects.create({ name: "Variable source" });
    const variable = {
      projectId: id,
      key: "headline",
      type: "string",
      value: "Original",
      expectedRevision: 0,
    };
    expect(await success(token, "save_project_variable", variable)).toMatchObject({
      revision: 1,
      value: "Original",
    });
    expect(await success(token, "list_project_variables", { projectId: id })).toMatchObject({
      effective: { values: [{ key: "headline", value: "Original" }] },
    });
    expect(
      await success(token, "get_project_variable_uses", { projectId: id, key: "headline" }),
    ).toEqual({ value: [] });
    expect(
      await success(token, "preview_project_variable_impact", {
        ...variable,
        value: "Updated",
        expectedRevision: 1,
      }),
    ).toEqual({ value: [] });
    const preview = await success(token, "preview_project_clone", {
      id,
      options: { name: "MCP clone" },
    });
    expect(preview).toMatchObject({ sourceProjectId: id, status: "preview" });
    await success(token, "save_project_variable", {
      ...variable,
      value: "Updated",
      expectedRevision: 1,
    });
    const start = { id, jobId: preview.id, requestKey: crypto.randomUUID() };
    const clone = await success(token, "start_project_clone", start);
    expect(clone).toMatchObject({
      id: preview.id,
      targetProjectId: preview.targetProjectId,
      status: "queued",
    });
    expect(await success(token, "start_project_clone", start)).toMatchObject({
      id: preview.id,
      targetProjectId: preview.targetProjectId,
    });
    expect(
      await new ProjectCloneRepository(env.DB, { workspaceId }).process(preview.id as string),
    ).toBe("completed");
    expect(await success(token, "get_project_clone", { id, jobId: preview.id })).toMatchObject({
      status: "completed",
    });
    expect(await success(token, "list_project_clones", { id })).toMatchObject({
      value: [expect.objectContaining({ id: preview.id })],
    });
    expect(
      await client.projects.variablesList({ projectId: preview.targetProjectId as string }),
    ).toMatchObject({ effective: { values: [{ key: "headline", value: "Original" }] } });
    expect(
      await call(token, "delete_project_variable", {
        projectId: id,
        key: "headline",
        expectedRevision: 1,
      }),
    ).toMatchObject({ isError: true, structuredContent: { code: "VARIABLE_CONFLICT" } });
    expect(
      await success(token, "delete_project_variable", {
        projectId: id,
        key: "headline",
        expectedRevision: 2,
      }),
    ).toEqual({ ok: true });
  });

  it("creates and publishes a batch graph and preserves preview version and run request identity", async () => {
    const { token, client } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({ email: "mcp-run@example.com" });
    const definition = {
      name: "MCP batch",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: {
            source: "batch",
            reentry: "every_time",
            audience: {
              kind: "filter",
              filter: { kind: "condition", field: "score", operator: "gte", value: 0 },
            },
            schedule: { kind: "now" },
          },
        },
      ],
      edges: [],
    };
    const created = await success(token, "create_automation", definition);
    const id = created.id as string;
    expect(
      (
        await call(token, "create_automation", {
          ...definition,
          projectId: "missing-brief-revision",
        })
      ).isError,
    ).toBe(true);
    expect(
      await success(token, "save_automation_draft", {
        ...definition,
        id,
        name: "MCP revised batch",
      }),
    ).toEqual({ ok: true });
    expect(await success(token, "get_automation_definition", { id })).toMatchObject({
      graph: { name: "MCP revised batch" },
    });
    const published = await success(token, "publish_automation", { id });
    const preview = await success(token, "preview_automation_run", { id });
    expect(preview).toMatchObject({ versionId: published.publishedVersionId, count: 1 });
    expect(
      (await call(token, "start_automation_run", { id, requestId: "missing-version" })).isError,
    ).toBe(true);
    const runInput = { id, requestId: crypto.randomUUID(), versionId: preview.versionId };
    const run = await success(token, "start_automation_run", runInput);
    const direct = await client.automations.runDetail({ id, runId: run.id as string });
    expect
      .soft({
        mcpCount: run.targetCount,
        apiCount: direct.run.targetCount,
        targetIds: direct.targets.map((target) => target.contactId),
      })
      .toEqual({ mcpCount: 1, apiCount: 1, targetIds: [contact.id] });
    expect(run).toMatchObject({ automationVersionId: preview.versionId });
    expect(await success(token, "start_automation_run", runInput)).toMatchObject({ id: run.id });
    expect(await success(token, "get_automation_run", { id, runId: run.id })).toMatchObject({
      run: { id: run.id },
      targets: [expect.objectContaining({ contactId: expect.any(String) })],
    });
    expect(await success(token, "list_automation_runs", { id })).toMatchObject({
      value: [expect.objectContaining({ id: run.id })],
    });
    expect(await success(token, "cancel_automation_run", { id, runId: run.id })).toEqual({
      ok: true,
    });
    expect(await client.automations.runDetail({ id, runId: run.id as string })).toMatchObject({
      run: { status: "cancelled" },
    });
    const enrollment = await client.automations.enroll({
      id,
      contactId: contact.id,
      sourceEventId: crypto.randomUUID(),
    });
    expect(
      await success(token, "get_automation_enrollment", {
        id,
        enrollmentId: enrollment.enrollmentId,
      }),
    ).toMatchObject({ contactId: contact.id, children: [] });
    expect(await success(token, "list_automation_enrollments", { id })).toMatchObject({
      value: [expect.objectContaining({ id: enrollment.enrollmentId })],
    });
    expect(
      await success(token, "cancel_automation_enrollment", {
        id,
        enrollmentId: enrollment.enrollmentId,
      }),
    ).toEqual({ ok: true });
    expect(
      await client.automations.enrollmentDetail({ id, enrollmentId: enrollment.enrollmentId }),
    ).toMatchObject({ status: "cancelled" });
    expect(await success(token, "set_automation_status", { id, status: "paused" })).toEqual({
      status: "paused",
    });
  });
});
