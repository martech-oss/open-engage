import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { compileSegmentFilter } from "@openengage/core/segments";
import { SegmentRepository, createDatabase } from "@openengage/database/testing";

import { reconcileContactSegmentMemberships } from "../src/segments/membership-service";
import { seedWorkspaceClient } from "./factory";

describe("segment designer support", () => {
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

    const repository = new SegmentRepository(env.DB, {
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
