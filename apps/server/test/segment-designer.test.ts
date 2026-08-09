import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "@openengage/database";

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
});
