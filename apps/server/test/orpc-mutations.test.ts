import type { ContractRouterClient } from "@orpc/contract";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentRepository, uuidv7 } from "@openengage/database";
import { contract } from "@openengage/orpc";

import { createFixtureClient, seedWorkspaceClient } from "./factory";

type Client = ContractRouterClient<typeof contract>;
type SegmentWrite = "create" | "update";

const segmentWrites = ["create", "update"] as const satisfies readonly SegmentWrite[];
const nonSlugConstraints = [
  ["foreign key", "SQLITE_CONSTRAINT: FOREIGN KEY constraint failed"],
  ["check", "SQLITE_CONSTRAINT: CHECK constraint failed: segments_kind_check"],
  ["not null", "SQLITE_CONSTRAINT: NOT NULL constraint failed: segments.name"],
] as const;

afterEach(() => vi.restoreAllMocks());

describe("oRPC mutations", () => {
  it.each(segmentWrites)(
    "maps a wrapped segment slug unique constraint to the conflict contract on %s",
    async (operation) => {
      const { client } = await seedWorkspaceClient(env.DB);
      rejectNextSegmentWrite(
        operation,
        new Error("wrapped database write", {
          cause: new Error(
            "SQLITE_CONSTRAINT: UNIQUE constraint failed: segments.workspace_id, segments.slug",
          ),
        }),
      );

      await expect(callSegmentWrite(client, operation)).rejects.toMatchObject({
        code: "SEGMENT_CONFLICT",
        status: 409,
      });
    },
  );

  it.each(
    segmentWrites.flatMap((operation) =>
      nonSlugConstraints.map(([kind, message]) => [kind, operation, message] as const),
    ),
  )("propagates a wrapped segment %s constraint on %s", async (_kind, operation, message) => {
    const { client } = await seedWorkspaceClient(env.DB);
    rejectNextSegmentWrite(
      operation,
      new Error("wrapped database write", { cause: new Error(message) }),
    );

    await expect(callSegmentWrite(client, operation)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      status: 500,
    });
  });

  it("keeps a real duplicate segment slug on the typed conflict path", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    await callSegmentWrite(client, "create");
    await expect(callSegmentWrite(client, "create")).rejects.toMatchObject({
      code: "SEGMENT_CONFLICT",
      status: 409,
    });
  });

  it("manages subscription topics", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const created = await client.consent.createTopic({
      name: "Newsletter",
      slug: "newsletter",
      description: "Monthly news",
      isDefault: true,
    });
    expect(created.id).toBeTruthy();
    const topics = await client.consent.listTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ slug: "newsletter", isDefault: true });
    await expect(
      client.consent.createTopic({
        name: "Duplicate",
        slug: "newsletter",
        description: "",
        isDefault: false,
      }),
    ).rejects.toMatchObject({ code: "TOPIC_CONFLICT", status: 409 });
  });

  it("manages projects and project items", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const { id } = await client.projects.create({
      name: "Spring launch",
      description: "",
      color: "#7c3aed",
    });
    const first = await client.projects.addItem({
      id,
      resourceType: "segment",
      resourceId: "segment-a",
    });
    expect(first.added).toBe(true);
    const second = await client.projects.addItem({
      id,
      resourceType: "segment",
      resourceId: "segment-a",
    });
    expect(second.added).toBe(false);
    const projects = await client.projects.list();
    expect(projects[0]).toMatchObject({ id, name: "Spring launch", itemCount: 1 });
    await expect(
      client.projects.addItem({ id: uuidv7(), resourceType: "segment", resourceId: "x" }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("manages webhook endpoints with URL safety checks", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const created = await client.workspace.createWebhookEndpoint({
      name: "CRM sync",
      url: "https://hooks.example.com/openengage",
      eventTypes: ["contact.created"],
    });
    expect(created.signingSecret.length).toBeGreaterThanOrEqual(40);
    const endpoints = await client.workspace.listWebhookEndpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      name: "CRM sync",
      url: "https://hooks.example.com/openengage",
      eventTypes: ["contact.created"],
      enabled: true,
    });
    await expect(
      client.workspace.createWebhookEndpoint({
        name: "Private",
        url: "https://10.0.0.8/hook",
        eventTypes: [],
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_WEBHOOK_URL", status: 422 });
  });

  it("reads a contact, its timeline, and records custom events", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "timeline@example.com",
      customFields: {},
    });
    const fetched = await client.contacts.get({ id: contact.id });
    expect(fetched.email).toBe("timeline@example.com");
    const recorded = await client.contacts.recordEvent({
      id: contact.id,
      eventName: "plan_upgraded",
      source: "api",
      properties: { plan: "pro" },
    });
    expect(recorded.eventId).toBeTruthy();
    const timeline = await client.contacts.timeline({ id: contact.id });
    const types = timeline.map((event) => event.type);
    expect(types).toContain("contact_created");
    expect(types).toContain("custom_event");
    const custom = timeline.find((event) => event.type === "custom_event");
    expect(custom).toMatchObject({ resourceId: "plan_upgraded", properties: { plan: "pro" } });
    await expect(client.contacts.timeline({ id: uuidv7() })).rejects.toMatchObject({
      code: "CONTACT_NOT_FOUND",
    });
  });

  it("previews a segment filter without persisting it", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    await client.contacts.create({ email: "match@acme.dev", customFields: {} });
    await client.contacts.create({ email: "other@different.io", customFields: {} });
    const preview = await client.segments.preview({
      filter: { kind: "condition", field: "email", operator: "contains", value: "acme.dev" },
    });
    expect(preview.capped).toBe(false);
    expect(preview.contacts).toHaveLength(1);
    expect(preview.contacts[0]?.email).toBe("match@acme.dev");
  });

  it("creates an API key whose token authenticates with its prefix", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const created = await client.workspace.createApiKey({ name: "CI key", role: "analyst" });
    expect(created.token.startsWith(`openengage_${created.prefix}_`)).toBe(true);
    const analystClient: Client = createFixtureClient({ token: created.token });
    await expect(analystClient.workspace.get()).resolves.toMatchObject({ role: "analyst" });

    const legacyPrefix = ["kae", "nma"].join("");
    const legacyClient: Client = createFixtureClient({
      token: created.token.replace(/^openengage_/, `${legacyPrefix}_`),
    });
    await expect(legacyClient.workspace.get()).rejects.toMatchObject({
      code: "INVALID_API_KEY",
      status: 401,
    });
  });

  it("starts a contact export and reports its data job", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const { jobId } = await client.contacts.startExport();
    const job = await client.contacts.getDataJob({ id: jobId });
    expect(job).toMatchObject({ id: jobId, kind: "contact_export", status: "pending" });
    await expect(client.contacts.downloadExport({ id: jobId })).rejects.toMatchObject({
      code: "EXPORT_NOT_READY",
    });
  });

  it("accepts a CSV import file and rejects one without identifiers", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const csv = "email,first_name\nimport-a@example.com,Ay\nimport-b@example.com,Bee\n";
    const started = await client.contacts.startImport({
      file: new File([csv], "contacts.csv", { type: "text/csv" }),
    });
    expect(started).toMatchObject({ rows: 2, parts: 1 });
    await expect(
      client.contacts.startImport({
        file: new File(["first_name\nNoId\n"], "broken.csv", { type: "text/csv" }),
      }),
    ).rejects.toMatchObject({ code: "CSV_IDENTIFIER_MISSING" });
  });

  it("uploads and downloads an asset through R2", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const uploaded = await client.assets.upload({
      name: "logo.png",
      file: new File(["openengage"], "logo.png", { type: "image/png" }),
    });
    expect(uploaded).toMatchObject({
      name: "logo.png",
      contentType: "image/png",
      kind: "image",
      visibility: "private",
      publicUrl: null,
    });
    const file = await client.assets.download({ id: uploaded.id });
    expect(await file.text()).toBe("openengage");
    await expect(client.assets.download({ id: uuidv7() })).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });
  });

  it("refuses to store content types the delivery routes would execute", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    await expect(
      client.assets.upload({
        name: "logo.svg",
        file: new File(["<svg onload='steal()' />"], "logo.svg", { type: "image/svg+xml" }),
      }),
    ).rejects.toMatchObject({ code: "ASSET_CONTENT_TYPE_BLOCKED" });
  });

  it("lists dead letters and rejects replaying unknown entries", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    await expect(client.platform.listDeadLetters()).resolves.toEqual([]);
    await expect(client.platform.replayDeadLetter({ id: uuidv7() })).rejects.toMatchObject({
      code: "DEAD_LETTER_NOT_FOUND",
    });
  });

  it("guards manual enrollment and serves per-automation analytics", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    await expect(
      client.automations.enroll({ id: uuidv7(), contactId: uuidv7() }),
    ).rejects.toMatchObject({ code: "AUTOMATION_NOT_ACTIVE" });
    await expect(client.automations.analytics({ id: uuidv7() })).resolves.toEqual({
      enrollments: [],
      deliveries: [],
    });
  });
});

function rejectNextSegmentWrite(operation: SegmentWrite, error: Error): void {
  if (operation === "create") {
    vi.spyOn(SegmentRepository.prototype, "createSegment").mockRejectedValueOnce(error);
    return;
  }
  vi.spyOn(SegmentRepository.prototype, "updateSegment").mockRejectedValueOnce(error);
}

function callSegmentWrite(client: Client, operation: SegmentWrite): Promise<unknown> {
  if (operation === "create") {
    return client.segments.create({
      name: "Duplicate segment",
      slug: "duplicate-segment",
      kind: "static",
      membershipSource: "Manual",
    });
  }
  return client.segments.update({
    id: uuidv7(),
    name: "Duplicate segment",
    slug: "duplicate-segment",
    description: "",
    kind: "static",
    filter: null,
    membershipSource: "Manual",
  });
}
