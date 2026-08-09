import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { WorkspaceRole } from "@openengage/orpc";

import { seedWorkspaceClient } from "./factory";

async function seedWorkspace(role: WorkspaceRole = "owner") {
  const { client } = await seedWorkspaceClient(env.DB, { role, timezone: "Asia/Tokyo" });
  return client;
}

/**
 * These endpoints read snake_case columns and must publish camelCase. The
 * mapping is hand-written per column, so a typo cannot be caught by tsc --
 * only by asserting the values arrive populated.
 */
describe("contact resources over oRPC", () => {
  it("maps option rows to camelCase with counts", async () => {
    const client = await seedWorkspace();
    const tag = await client.contacts.createTag({ name: "VIP", color: "#0f766e" });
    const group = await client.segments.create({
      name: "Customers",
      slug: "customers",
      kind: "static",
    });
    const contact = await client.contacts.create({
      email: "res@example.com",
      stage: "customer",
      customFields: {},
    });
    await client.contacts.assignTag({ contactId: contact.id, resourceId: tag.id });
    await client.contacts.addToSegment({ contactId: contact.id, resourceId: group.id });

    const options = await client.contacts.options();
    expect(options.tags).toEqual([
      { id: tag.id, name: "VIP", slug: tag.slug, color: "#0f766e", contactCount: 1 },
    ]);
    expect(options.segments).toEqual([
      {
        id: group.id,
        name: "Customers",
        slug: group.slug,
        description: "",
        kind: "static",
        filterAst: null,
        membershipSource: "Manual selection",
        filterVersion: 1,
        memberCount: 1,
        evaluatedAt: null,
        evaluationStatus: "ready",
        evaluationError: null,
      },
    ]);
    expect(options.stages).toEqual([{ stage: "customer", contactCount: 1 }]);
  });

  it("maps the profile to camelCase, including the account relation", async () => {
    const client = await seedWorkspace();
    const account = await client.companies.create({ name: "Globex" });
    const contact = await client.contacts.create({ email: "p@example.com", customFields: {} });
    await client.companies.assignContact({
      id: account.id,
      contactId: contact.id,
      title: "VP",
      isPrimary: true,
    });
    await client.contacts.adjustScore({
      contactId: contact.id,
      delta: 5,
      reason: "signup",
    });

    const profile = await client.contacts.profile({ contactId: contact.id });
    expect(profile.companies).toEqual([
      { id: account.id, name: "Globex", domain: null, title: "VP", isPrimary: true },
    ]);
    expect(profile.scoreEvents).toEqual([expect.objectContaining({ delta: 5, reason: "signup" })]);
    expect(profile.scoreEvents[0]?.createdAt).toEqual(expect.any(String));
    expect(profile.contact.score).toBe(5);
  });

  it("requires admin for a bulk archive but allows marketer to tag", async () => {
    const client = await seedWorkspace("marketer");
    const tag = await client.contacts.createTag({ name: "Bulk", color: "#64748b" });
    const contact = await client.contacts.create({ email: "b@example.com", customFields: {} });

    await expect(
      client.contacts.bulkUpdate({ contactIds: [contact.id], action: "archive" }),
    ).rejects.toMatchObject({ code: "ARCHIVE_FORBIDDEN", status: 403 });

    await expect(
      client.contacts.bulkUpdate({ contactIds: [contact.id], action: "add_tag" }),
    ).rejects.toMatchObject({ code: "RESOURCE_REQUIRED", status: 422 });

    await expect(
      client.contacts.bulkUpdate({
        contactIds: [contact.id],
        action: "add_tag",
        resourceId: tag.id,
      }),
    ).resolves.toEqual({ updated: 1 });
  });

  it("rejects a duplicate tag name", async () => {
    const client = await seedWorkspace();
    await client.contacts.createTag({ name: "Dup", color: "#64748b" });
    await expect(
      client.contacts.createTag({ name: "Dup", color: "#64748b" }),
    ).rejects.toMatchObject({ code: "TAG_CONFLICT", status: 409 });
  });
});
