import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { compileSegmentFilter } from "@openengage/core/segments";
import { SegmentEvaluationRepository, createDatabase } from "@openengage/database/testing";

import { reconcileContactSegmentMemberships } from "../src/segments/membership-service";
import { seedWorkspaceClient } from "./factory";

describe("segment designer support", () => {
  it("keeps a static segment ready when a manual recount is queued", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const segment = await client.segments.create({
      name: "Static refresh state",
      slug: "static-refresh-state",
      kind: "static",
      membershipSource: "Manual selection",
    });

    await expect(client.segments.refresh({ id: segment.id })).resolves.toEqual({ ok: true });
    await expect(client.segments.get({ id: segment.id })).resolves.toMatchObject({
      evaluationStatus: "ready",
    });
  });

  it("validates workspace resources and previews an exact active count", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const tag = await client.contacts.createTag({ name: "VIP", color: "#0f766e" });
    await client.consent.createTopic({
      name: "Product updates",
      slug: "product-updates",
      description: "Product news",
      isDefault: false,
    });
    const active = await client.contacts.create({
      email: "active-segment@example.com",
      customFields: {},
    });
    const archived = await client.contacts.create({
      email: "archived-segment@example.com",
      customFields: {},
    });
    await client.contacts.archive({ id: archived.id });
    await client.contacts.assignTag({ contactId: active.id, resourceId: tag.id });
    await client.contacts.recordEvent({
      id: active.id,
      eventName: "trial_activated",
      source: "api",
      properties: {},
    });

    const options = await client.segments.options();
    expect(options.tags).toContainEqual(expect.objectContaining({ value: tag.slug }));
    expect(options.subscriptionTopics).toContainEqual(
      expect.objectContaining({ value: "product-updates" }),
    );
    expect(options.events).toContainEqual(expect.objectContaining({ value: "trial_activated" }));

    const valid = await client.segments.validate({
      filter: { kind: "condition", field: "tag", operator: "eq", value: tag.slug },
    });
    expect(valid).toMatchObject({ valid: true });
    const invalid = await client.segments.validate({
      filter: { kind: "condition", field: "tag", operator: "eq", value: "missing" },
    });
    expect(invalid).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "resource_not_found", path: "$.value" })],
    });

    const preview = await client.segments.preview({
      filter: {
        kind: "condition",
        field: "email",
        operator: "contains",
        value: "segment@example.com",
      },
    });
    expect(preview).toMatchObject({ matchedCount: 1, capped: false });
    expect(preview.contacts.map((contact) => contact.id)).toEqual([active.id]);

    const eventPreview = await client.segments.preview({
      filter: {
        kind: "condition",
        field: "event",
        key: "trial_activated",
        operator: "exists",
        value: null,
      },
    });
    expect(eventPreview.contacts.map((contact) => contact.id)).toEqual([active.id]);
  });

  it("reconciles one changed contact idempotently", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "score-segment@example.com",
      customFields: {},
    });
    const segment = await client.segments.create({
      name: "High score",
      slug: "high-score",
      kind: "dynamic",
      filter: { kind: "condition", field: "score", operator: "gte", value: 50 },
    });
    await client.contacts.adjustScore({ contactId: contact.id, delta: 60, reason: "qualified" });

    const database = createDatabase(env.DB);
    await reconcileContactSegmentMemberships(database, workspaceId, contact.id);
    await reconcileContactSegmentMemberships(database, workspaceId, contact.id);
    expect((await client.segments.get({ id: segment.id })).memberCount).toBe(1);

    await client.contacts.adjustScore({ contactId: contact.id, delta: -60, reason: "reset" });
    await reconcileContactSegmentMemberships(database, workspaceId, contact.id);
    expect((await client.segments.get({ id: segment.id })).memberCount).toBe(0);
  });

  it("does not apply a contact match computed for a superseded filter version", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "contact-filter-race@example.com",
      customFields: {},
    });
    await insertDynamicSegment("contact-filter-race", workspaceId, {
      kind: "condition",
      field: "email",
      operator: "eq",
      value: contact.email,
    });
    const raced = beforeDatabaseBatch(env.DB, 2, async () => {
      await env.DB.prepare(
        "UPDATE segments SET filter_version = filter_version + 1, evaluation_status = 'pending' WHERE id = ?",
      )
        .bind("contact-filter-race")
        .run();
    });

    await reconcileContactSegmentMemberships(createDatabase(raced), workspaceId, contact.id);

    expect(await membershipSummary(workspaceId, contact.id)).toEqual({
      memberships: 0,
      memberCount: 0,
    });
  });

  it("leaves memberships and evaluation state untouched for a stale filter version", async () => {
    const { client, workspaceId, userId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "stale-segment@example.com",
      customFields: {},
    });
    const created = await client.segments.create({
      name: "Original dynamic filter",
      slug: "original-dynamic-filter",
      kind: "dynamic",
      filter: { kind: "condition", field: "email", operator: "contains", value: "no-match" },
    });
    const beforeUpdate = await client.segments.get({ id: created.id });
    await client.segments.update({
      id: created.id,
      name: "Updated dynamic filter",
      slug: "updated-dynamic-filter",
      description: "",
      kind: "dynamic",
      filter: { kind: "condition", field: "email", operator: "contains", value: "still-no-match" },
      membershipSource: null,
    });
    const beforeStaleRefresh = await client.segments.get({ id: created.id });

    const repository = new SegmentEvaluationRepository(env.DB, {
      workspaceId,
      userId,
      role: "owner",
    });
    await repository.replaceDynamicMemberships(
      created.id,
      compileSegmentFilter(workspaceId, {
        kind: "condition",
        field: "email",
        operator: "eq",
        value: contact.email,
      }),
      beforeUpdate.filterVersion,
    );

    await expect(client.segments.get({ id: created.id })).resolves.toMatchObject({
      filterVersion: beforeStaleRefresh.filterVersion,
      memberCount: beforeStaleRefresh.memberCount,
      evaluationStatus: beforeStaleRefresh.evaluationStatus,
      evaluatedAt: beforeStaleRefresh.evaluatedAt,
      updatedAt: beforeStaleRefresh.updatedAt,
    });
  });

  it("guards the full-refresh delete, insert, and exact count inside the batch", async () => {
    const { client, workspaceId, userId } = await seedWorkspaceClient(env.DB);
    const oldContact = await client.contacts.create({
      email: "old-full-refresh@example.com",
      customFields: {},
    });
    const newContact = await client.contacts.create({
      email: "new-full-refresh@example.com",
      customFields: {},
    });
    await insertDynamicSegment("full-refresh-race", workspaceId, {
      kind: "condition",
      field: "email",
      operator: "eq",
      value: oldContact.email,
    });
    const repository = new SegmentEvaluationRepository(env.DB, {
      workspaceId,
      userId,
      role: "owner",
    });
    await repository.replaceDynamicMemberships(
      "full-refresh-race",
      compileSegmentFilter(workspaceId, {
        kind: "condition",
        field: "email",
        operator: "eq",
        value: oldContact.email,
      }),
      1,
    );
    await env.DB.prepare("UPDATE segments SET member_count = 99 WHERE id = ?")
      .bind("full-refresh-race")
      .run();
    const raced = beforeDatabaseBatch(env.DB, 1, async () => {
      await env.DB.prepare(
        "UPDATE segments SET filter_version = 2, evaluation_status = 'pending' WHERE id = ?",
      )
        .bind("full-refresh-race")
        .run();
    });

    await new SegmentEvaluationRepository(raced, {
      workspaceId,
      userId,
      role: "owner",
    }).replaceDynamicMemberships(
      "full-refresh-race",
      compileSegmentFilter(workspaceId, {
        kind: "condition",
        field: "email",
        operator: "eq",
        value: newContact.email,
      }),
      1,
    );

    const rows = await env.DB.prepare(
      `SELECT sm.contact_id AS contactId, s.member_count AS memberCount,
              s.filter_version AS filterVersion, s.evaluation_status AS evaluationStatus
       FROM segments s
       LEFT JOIN segment_memberships sm
         ON sm.workspace_id = s.workspace_id AND sm.segment_id = s.id
       WHERE s.workspace_id = ? AND s.id = ?`,
    )
      .bind(workspaceId, "full-refresh-race")
      .all<{
        contactId: string | null;
        memberCount: number;
        filterVersion: number;
        evaluationStatus: string;
      }>();
    expect(rows.results).toEqual([
      {
        contactId: oldContact.id,
        memberCount: 99,
        filterVersion: 2,
        evaluationStatus: "pending",
      },
    ]);

    await repository.replaceDynamicMemberships(
      "full-refresh-race",
      compileSegmentFilter(workspaceId, {
        kind: "condition",
        field: "email",
        operator: "eq",
        value: oldContact.email,
      }),
      2,
    );
    expect(await membershipSummary(workspaceId, oldContact.id)).toEqual({
      memberships: 1,
      memberCount: 1,
    });
  });

  it("filters the segment list by static and dynamic kinds", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const dynamic = await client.segments.create({
      name: "Active leads",
      slug: "active-leads",
      kind: "dynamic",
      filter: { kind: "condition", field: "status", operator: "eq", value: "active" },
    });
    const list = await client.segments.create({
      name: "Event attendees",
      slug: "event-attendees",
      kind: "static",
      membershipSource: "Manual selection",
    });

    await expect(client.segments.list({ kind: "dynamic" })).resolves.toEqual([
      expect.objectContaining({ id: dynamic.id, kind: "dynamic" }),
    ]);
    await expect(client.segments.list({ kind: "static" })).resolves.toEqual([
      expect.objectContaining({ id: list.id, kind: "static" }),
    ]);
  });
});

type SegmentFilterInput = Parameters<typeof compileSegmentFilter>[1];

async function insertDynamicSegment(
  id: string,
  workspaceId: string,
  filter: SegmentFilterInput,
): Promise<void> {
  await dynamicSegmentInsert().bind(id, workspaceId, id, JSON.stringify(filter)).run();
}

function dynamicSegmentInsert(): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO segments (
       id, workspace_id, name, slug, description, kind, filter_ast,
       membership_source, filter_version, member_count, evaluated_at,
       evaluation_status, evaluation_error, created_at, updated_at
     ) VALUES (?, ?, 'Dynamic segment', ?, '', 'dynamic', ?, NULL, 1, 0, NULL, 'ready', NULL,
       '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z')`,
  );
}

async function membershipSummary(
  workspaceId: string,
  contactId: string,
): Promise<{ memberships: number; memberCount: number }> {
  const [memberships, memberCount] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM segment_memberships WHERE workspace_id = ? AND contact_id = ?",
    )
      .bind(workspaceId, contactId)
      .first<{ count: number }>(),
    env.DB.prepare(
      "SELECT COALESCE(SUM(member_count), 0) AS memberCount FROM segments WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first<{ memberCount: number }>(),
  ]);
  return {
    memberships: Number(memberships?.count ?? 0),
    memberCount: Number(memberCount?.memberCount ?? 0),
  };
}

function beforeDatabaseBatch(
  source: D1Database,
  batchNumber: number,
  barrier: () => Promise<void>,
): D1Database {
  let batches = 0;
  return new Proxy(source, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          batches += 1;
          if (batches === batchNumber) await barrier();
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
