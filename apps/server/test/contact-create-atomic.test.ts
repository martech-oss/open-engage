import type { ContractRouterClient } from "@orpc/contract";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  companies,
  companyContacts,
  contactEventOutbox,
  contactEvents,
  contacts,
  contactTags,
  createDatabase,
  segmentMemberships,
  segments,
  tags,
  uuidv7,
} from "@openengage/database/testing";
import { contract } from "@openengage/orpc";

import { seedWorkspaceClient } from "./factory";

type Client = ContractRouterClient<typeof contract>;
type CreateCommand = Parameters<Client["contacts"]["create"]>[0] & {
  tagId?: string;
  segmentId?: string;
  companyId?: string;
};

const database = () => createDatabase(env.DB);

describe("atomic contact creation with initial relations", () => {
  let primary: Awaited<ReturnType<typeof seedWorkspaceClient>>;
  let foreign: Awaited<ReturnType<typeof seedWorkspaceClient>>;
  let tagId: string;
  let segmentId: string;
  let dynamicSegmentId: string;
  let companyId: string;
  let foreignTagId: string;
  let foreignSegmentId: string;
  let foreignCompanyId: string;

  beforeEach(async () => {
    primary = await seedWorkspaceClient(env.DB);
    foreign = await seedWorkspaceClient(env.DB);
    tagId = uuidv7();
    segmentId = uuidv7();
    dynamicSegmentId = uuidv7();
    companyId = uuidv7();
    foreignTagId = uuidv7();
    foreignSegmentId = uuidv7();
    foreignCompanyId = uuidv7();
    const now = new Date().toISOString();
    const orm = database().orm;
    await orm.batch([
      orm.insert(tags).values({
        id: tagId,
        workspaceId: primary.workspaceId,
        name: "Primary tag",
        slug: `primary-${tagId}`,
        createdAt: now,
      }),
      orm.insert(segments).values({
        id: segmentId,
        workspaceId: primary.workspaceId,
        name: "Primary static segment",
        slug: `primary-static-${segmentId}`,
        kind: "static",
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(segments).values({
        id: dynamicSegmentId,
        workspaceId: primary.workspaceId,
        name: "Primary dynamic segment",
        slug: `primary-dynamic-${dynamicSegmentId}`,
        kind: "dynamic",
        filterAst: JSON.stringify({
          kind: "condition",
          field: "status",
          operator: "eq",
          value: "active",
        }),
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(companies).values({
        id: companyId,
        workspaceId: primary.workspaceId,
        name: "Primary company",
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(tags).values({
        id: foreignTagId,
        workspaceId: foreign.workspaceId,
        name: "Foreign tag",
        slug: `foreign-${foreignTagId}`,
        createdAt: now,
      }),
      orm.insert(segments).values({
        id: foreignSegmentId,
        workspaceId: foreign.workspaceId,
        name: "Foreign static segment",
        slug: `foreign-static-${foreignSegmentId}`,
        kind: "static",
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(companies).values({
        id: foreignCompanyId,
        workspaceId: foreign.workspaceId,
        name: "Foreign company",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  });

  it.each([
    { label: "none", relations: {}, expected: [0, 0, 0] },
    { label: "tag", relations: { tagId: true }, expected: [1, 0, 0] },
    { label: "segment", relations: { segmentId: true }, expected: [0, 1, 0] },
    { label: "company", relations: { companyId: true }, expected: [0, 0, 1] },
    {
      label: "tag and segment",
      relations: { tagId: true, segmentId: true },
      expected: [1, 1, 0],
    },
    {
      label: "tag and company",
      relations: { tagId: true, companyId: true },
      expected: [1, 0, 1],
    },
    {
      label: "segment and company",
      relations: { segmentId: true, companyId: true },
      expected: [0, 1, 1],
    },
    {
      label: "all",
      relations: { tagId: true, segmentId: true, companyId: true },
      expected: [1, 1, 1],
    },
  ])(
    "persists $label relation selection with the created event",
    async ({ relations, expected }) => {
      const command: CreateCommand = {
        email: `relations-${uuidv7()}@example.com`,
        customFields: {},
        ...(relations.tagId ? { tagId } : {}),
        ...(relations.segmentId ? { segmentId } : {}),
        ...(relations.companyId ? { companyId } : {}),
      };

      const contact = await primary.client.contacts.create(command);
      const stored = await env.DB.prepare(
        `SELECT
        (SELECT COUNT(*) FROM contact_tags WHERE workspace_id = ? AND contact_id = ?) AS tags,
        (SELECT COUNT(*) FROM segment_memberships WHERE workspace_id = ? AND contact_id = ?) AS segments,
        (SELECT COUNT(*) FROM company_contacts WHERE workspace_id = ? AND contact_id = ?) AS companies,
        (SELECT COUNT(*) FROM contact_events WHERE workspace_id = ? AND contact_id = ? AND type = 'contact_created') AS events,
        (SELECT COUNT(*) FROM contact_event_outbox o INNER JOIN contact_events e ON e.id = o.event_id WHERE o.workspace_id = ? AND e.contact_id = ?) AS outbox`,
      )
        .bind(
          primary.workspaceId,
          contact.id,
          primary.workspaceId,
          contact.id,
          primary.workspaceId,
          contact.id,
          primary.workspaceId,
          contact.id,
          primary.workspaceId,
          contact.id,
        )
        .first<{
          tags: number;
          segments: number;
          companies: number;
          events: number;
          outbox: number;
        }>();

      expect(stored).toEqual({
        tags: expected[0],
        segments: expected[1],
        companies: expected[2],
        events: 1,
        outbox: 1,
      });
    },
  );

  it.each([
    ["tagId", () => uuidv7()],
    ["tagId", () => foreignTagId],
    ["segmentId", () => uuidv7()],
    ["segmentId", () => foreignSegmentId],
    ["segmentId", () => dynamicSegmentId],
    ["companyId", () => uuidv7()],
    ["companyId", () => foreignCompanyId],
  ] as const)("rejects invalid %s before leaving any write residue", async (field, value) => {
    const email = `invalid-${field}-${uuidv7()}@example.com`;
    const before = await workspaceWriteCounts(primary.workspaceId);

    await expect(
      primary.client.contacts.create({
        email,
        customFields: {},
        [field]: value(),
      } as CreateCommand),
    ).rejects.toMatchObject({
      code: "CONTACT_RELATION_INVALID",
      status: 422,
      data: { field },
    });

    expect(await workspaceWriteCounts(primary.workspaceId)).toEqual(before);
    await expect(contactCountByEmail(primary.workspaceId, email)).resolves.toBe(0);
  });

  it("rolls back the contact and event when a relation write fails inside the batch", async () => {
    const email = `write-failure-${uuidv7()}@example.com`;
    const before = await workspaceWriteCounts(primary.workspaceId);
    await env.DB.prepare(
      `CREATE TRIGGER forced_contact_tag_failure
       BEFORE INSERT ON contact_tags
       BEGIN
         SELECT RAISE(ABORT, 'forced contact-tag failure');
       END`,
    ).run();

    try {
      await expect(
        primary.client.contacts.create({ email, customFields: {}, tagId } as CreateCommand),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", status: 500 });
      expect(await workspaceWriteCounts(primary.workspaceId)).toEqual(before);
      await expect(contactCountByEmail(primary.workspaceId, email)).resolves.toBe(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER IF EXISTS forced_contact_tag_failure").run();
    }
  });

  it("keeps duplicate contact conflicts compatible and rolls back requested relations and event", async () => {
    const email = `duplicate-${uuidv7()}@example.com`;
    const original = await primary.client.contacts.create({ email, customFields: {} });
    const before = await workspaceWriteCounts(primary.workspaceId);

    await expect(
      primary.client.contacts.create({
        email,
        customFields: {},
        tagId,
        segmentId,
        companyId,
      } as CreateCommand),
    ).rejects.toMatchObject({ code: "CONTACT_CONFLICT", status: 409 });

    expect(await workspaceWriteCounts(primary.workspaceId)).toEqual(before);
    await expect(contactCountByEmail(primary.workspaceId, email)).resolves.toBe(1);
    const relationCount = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM contact_tags WHERE contact_id = ?) +
        (SELECT COUNT(*) FROM segment_memberships WHERE contact_id = ?) +
        (SELECT COUNT(*) FROM company_contacts WHERE contact_id = ?) AS count`,
    )
      .bind(original.id, original.id, original.id)
      .first<{ count: number }>();
    expect(relationCount?.count).toBe(0);
  });
});

async function workspaceWriteCounts(workspaceId: string) {
  const [contactRows, tagRows, segmentRows, companyRows, eventRows, outboxRows] = await Promise.all(
    [
      database().orm.select().from(contacts),
      database().orm.select().from(contactTags),
      database().orm.select().from(segmentMemberships),
      database().orm.select().from(companyContacts),
      database().orm.select().from(contactEvents),
      database().orm.select().from(contactEventOutbox),
    ],
  );
  return {
    contacts: contactRows.filter((row) => row.workspaceId === workspaceId).length,
    tags: tagRows.filter((row) => row.workspaceId === workspaceId).length,
    segments: segmentRows.filter((row) => row.workspaceId === workspaceId).length,
    companies: companyRows.filter((row) => row.workspaceId === workspaceId).length,
    events: eventRows.filter((row) => row.workspaceId === workspaceId).length,
    outbox: outboxRows.filter((row) => row.workspaceId === workspaceId).length,
  };
}

async function contactCountByEmail(workspaceId: string, email: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ? AND email = ?",
  )
    .bind(workspaceId, email)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
