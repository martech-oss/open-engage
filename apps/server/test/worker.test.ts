import { env, exports } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  companies,
  companyContacts,
  ContactRepository,
  contacts,
  contactTags,
  createDatabase,
  IdempotencyRepository,
  segmentMemberships,
  segments,
  tags,
  uuidv7,
} from "@openengage/database/testing";

import { isEmailVerificationRequired, resolveAuthBaseURL } from "../src/auth/service";
import { seedWorkspace, seedWorkspaceClient } from "./factory";

describe("OpenEngage Worker", () => {
  it("uses the actual localhost port for Better Auth during development", () => {
    expect(
      resolveAuthBaseURL(
        { APP_URL: "http://localhost:8787", ENVIRONMENT: "development" },
        "http://localhost:8788",
      ),
    ).toBe("http://localhost:8788");
    expect(
      resolveAuthBaseURL(
        { APP_URL: "https://app.example.com", ENVIRONMENT: "production" },
        "https://evil.example.com",
      ),
    ).toBe("https://app.example.com");
  });

  it("skips email verification only in development", () => {
    expect(isEmailVerificationRequired("development")).toBe(false);
    expect(isEmailVerificationRequired("test")).toBe(true);
    expect(isEmailVerificationRequired("production")).toBe(true);
  });

  it("reports a healthy migrated D1 database", async () => {
    const response = await exports.default.fetch("http://localhost:8787/api/health");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { status: string; migrations: number } };
    expect(payload.data.status).toBe("ok");
    expect(payload.data.migrations).toBeGreaterThan(0);
  });

  it("never returns a contact from another workspace by direct ID", async () => {
    const { workspaceId: firstWorkspace } = await seedWorkspace(env.DB);
    const { workspaceId: secondWorkspace } = await seedWorkspace(env.DB);
    const first = new ContactRepository(env.DB, {
      workspaceId: firstWorkspace,
      userId: "user-one",
      role: "owner",
    });
    const second = new ContactRepository(env.DB, {
      workspaceId: secondWorkspace,
      userId: "user-two",
      role: "owner",
    });
    const contact = await first.createContact({
      email: "person@example.com",
      customFields: {},
    });
    expect(await first.getContact(contact.id)).not.toBeNull();
    expect(await second.getContact(contact.id)).toBeNull();
  });

  it("filters, paginates, archives, and restores contacts within a workspace", async () => {
    const { workspaceId } = await seedWorkspace(env.DB);
    const tagId = uuidv7();
    const segmentId = uuidv7();
    const accountId = uuidv7();
    const now = new Date().toISOString();
    const repository = new ContactRepository(env.DB, {
      workspaceId,
      userId: "contacts-owner",
      role: "owner",
    });
    const highScore = await repository.createContact({
      email: "high@example.com",
      firstName: "High",
      stage: "customer",
      customFields: {},
    });
    const lowScore = await repository.createContact({
      email: "low@example.com",
      firstName: "Low",
      stage: "lead",
      customFields: {},
    });
    const orm = createDatabase(env.DB).orm;
    await orm.batch([
      orm.insert(tags).values({
        id: tagId,
        workspaceId,
        name: "VIP",
        slug: `vip-${tagId}`,
        color: "#6366f1",
        createdAt: now,
      }),
      orm.insert(segments).values({
        id: segmentId,
        workspaceId,
        name: "Customers",
        slug: `customers-${segmentId}`,
        kind: "static",
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(companies).values({
        id: accountId,
        workspaceId,
        name: "Acme",
        domain: "acme.example",
        customFields: "{}",
        createdAt: now,
        updatedAt: now,
      }),
      orm
        .update(contacts)
        .set({ score: 80 })
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, highScore.id))),
      orm
        .update(contacts)
        .set({ score: 10 })
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, lowScore.id))),
    ]);
    await orm.batch([
      orm.insert(contactTags).values({
        workspaceId,
        contactId: highScore.id,
        tagId,
        createdAt: now,
      }),
      orm.insert(segmentMemberships).values({
        workspaceId,
        segmentId,
        contactId: highScore.id,
        source: "static",
        joinedAt: now,
      }),
      orm.insert(companyContacts).values({
        workspaceId,
        companyId: accountId,
        contactId: highScore.id,
        title: "Owner",
        isPrimary: true,
        createdAt: now,
      }),
    ]);

    const filtered = await repository.listContacts({
      tagId,
      segmentId,
      companyId: accountId,
      stage: "customer",
      scoreMin: 50,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.items.map((contact) => contact.id)).toEqual([highScore.id]);

    const firstPage = await repository.listContacts({
      limit: 1,
      sort: "score",
      direction: "desc",
    });
    expect(firstPage.total).toBe(2);
    expect(firstPage.items[0]?.id).toBe(highScore.id);
    expect(firstPage.nextCursor).toBe(highScore.id);
    const secondPage = await repository.listContacts({
      cursor: firstPage.nextCursor,
      limit: 1,
      sort: "score",
      direction: "desc",
    });
    expect(secondPage.total).toBe(2);
    expect(secondPage.items[0]?.id).toBe(lowScore.id);

    expect(await repository.archiveContact(highScore.id)).toBe(true);
    expect((await repository.listContacts({})).items.map((contact) => contact.id)).toEqual([
      lowScore.id,
    ]);
    const archived = await repository.listContacts({ status: "archived" });
    expect(archived.items[0]?.archivedAt).not.toBeNull();
    expect(await repository.restoreContact(highScore.id)).toBe(true);
    expect((await repository.listContacts({})).total).toBe(2);
  });

  it("manages the full contact profile through authenticated API routes", async () => {
    const { client } = await seedWorkspaceClient(env.DB);

    const tag = await client.contacts.createTag({ name: "VIP", color: "#6366f1" });
    expect(tag.id).toBeTruthy();
    const group = await client.segments.create({
      name: "Customers",
      slug: "customers",
      kind: "static",
    });
    expect(group.id).toBeTruthy();
    const account = await client.companies.create({ name: "Acme", domain: "acme.example" });
    expect(account.name).toBe("Acme");

    const contact = await client.contacts.create({
      email: "api-contact@example.com",
      firstName: "API",
      stage: "customer",
      customFields: {},
    });
    await expect(
      client.contacts.assignTag({ contactId: contact.id, resourceId: tag.id }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.contacts.addToSegment({ contactId: contact.id, resourceId: group.id }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.companies.assignContact({
        id: account.id,
        contactId: contact.id,
        title: "Marketing Lead",
        isPrimary: true,
      }),
    ).resolves.toEqual({ ok: true });
    const scored = await client.contacts.adjustScore({
      contactId: contact.id,
      delta: 75,
      reason: "Qualified lead",
    });
    expect(scored.score).toBe(75);

    const segment = await client.segments.create({
      name: "Tokyo VIP",
      slug: "tokyo-vip",
      kind: "dynamic",
      filter: {
        kind: "group",
        combinator: "and",
        children: [
          { kind: "condition", field: "tag", operator: "eq", value: tag.slug },
          { kind: "condition", field: "segment", operator: "eq", value: group.slug },
          { kind: "condition", field: "score", operator: "gte", value: 50 },
        ],
      },
    });
    expect(segment.id).toBeTruthy();

    const variable = await client.emails.createVariable({
      key: "brand_name",
      name: "Brand name",
      value: "OpenEngage",
      description: "Shared brand label",
    });
    expect(variable.id).toBeTruthy();
    await expect(
      client.emails.updateVariable({
        id: variable.id,
        key: "brand_name",
        name: "Brand name",
        value: "OpenEngage MA",
        description: "Updated shared brand label",
      }),
    ).resolves.toEqual({ ok: true });

    const content = {
      schemaVersion: 2 as const,
      previewText: "",
      theme: {
        backgroundColor: "#f4f5f7",
        surfaceColor: "#ffffff",
        textColor: "#171717",
        mutedTextColor: "#64748b",
        accentColor: "#171717",
        fontFamily: "sans" as const,
        width: 600,
      },
      blocks: [
        {
          id: "body",
          type: "markdown" as const,
          markdown: "Hello {{ contact.first_name }} from {{ workspace.name }}",
        },
      ],
    };
    const template = await client.emails.createTemplate({
      name: "Welcome",
      purpose: "transactional",
      subject: "Welcome {{ contact.first_name }}",
      content,
    });
    const templateId = template.id;
    const templates = await client.emails.listTemplates({ archived: false });
    expect(templates.find((template) => template.id === templateId)).toMatchObject({
      name: "Welcome",
      subject: "Welcome {{ contact.first_name }}",
      draftRevision: 1,
      publishedRevision: null,
      hasUnpublishedChanges: true,
      sendable: false,
    });
    await expect(
      client.emails.previewTemplate({
        purpose: "transactional",
        subject: "Welcome\n{{ contact.first_name }}",
        content,
      }),
    ).resolves.toMatchObject({
      subject: "Welcome 太郎",
      html: expect.stringContaining("Hello 太郎 from OpenEngage Workspace"),
      text: expect.stringContaining("Hello 太郎 from OpenEngage Workspace"),
    });
    await expect(client.emails.publishTemplate({ id: templateId })).resolves.toEqual({ ok: true });
    expect(
      (await client.emails.listTemplates({ archived: false })).find(
        (template) => template.id === templateId,
      ),
    ).toMatchObject({
      publishedRevision: 1,
      hasUnpublishedChanges: false,
      sendable: true,
    });
    await expect(
      client.emails.updateTemplate({
        id: templateId,
        name: "Welcome edited",
        subject: "Updated {{ contact.first_name }}",
        content,
      }),
    ).resolves.toEqual({ ok: true });
    expect(
      (await client.emails.listTemplates({ archived: false })).find(
        (template) => template.id === templateId,
      ),
    ).toMatchObject({
      draftRevision: 2,
      publishedRevision: 1,
      hasUnpublishedChanges: true,
      sendable: true,
    });
    const snapshot = await env.DB.prepare(
      `SELECT draft_subject AS draftSubject, published_subject AS publishedSubject,
              draft_revision AS draftRevision, published_revision AS publishedRevision
       FROM email_templates WHERE id = ?`,
    )
      .bind(templateId)
      .first<{
        draftSubject: string;
        publishedSubject: string;
        draftRevision: number;
        publishedRevision: number;
      }>();
    expect(snapshot).toEqual({
      draftSubject: "Updated {{ contact.first_name }}",
      publishedSubject: "Welcome {{ contact.first_name }}",
      draftRevision: 2,
      publishedRevision: 1,
    });

    await expect(client.emails.archiveTemplate({ id: templateId })).resolves.toEqual({ ok: true });
    await expect(client.emails.archiveVariable({ id: variable.id })).resolves.toEqual({ ok: true });

    const filtered = await client.contacts.list({
      tagId: tag.id,
      companyId: account.id,
      segmentId: group.id,
      scoreMin: 50,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({
      id: contact.id,
      tags: [expect.objectContaining({ id: tag.id })],
      companies: [expect.objectContaining({ id: account.id })],
    });

    const profile = await client.contacts.profile({ contactId: contact.id });
    expect(profile.contact.score).toBe(75);
    expect(profile.tags).toHaveLength(1);
    // Both the manually-added static group and the auto-refreshed dynamic
    // "Tokyo VIP" segment (created below, matching this contact's tag/group/
    // score) end up as memberships once the dynamic segment exists.
    expect(profile.segments.map((row) => row.id)).toContain(group.id);
    expect(profile.companies).toHaveLength(1);
    expect(profile.scoreEvents).toHaveLength(1);

    const accountDetail = await client.companies.get({ id: account.id });
    expect(accountDetail.name).toBe("Acme");
    expect(accountDetail.contacts).toEqual([
      expect.objectContaining({
        id: contact.id,
        title: "Marketing Lead",
      }),
    ]);

    await expect(client.contacts.archive({ id: contact.id })).resolves.toEqual({ ok: true });
    await expect(
      client.contacts.update({ id: contact.id, firstName: "Blocked" }),
    ).rejects.toMatchObject({ code: "CONTACT_ARCHIVED", status: 409 });
    await expect(
      client.contacts.removeTag({ contactId: contact.id, resourceId: tag.id }),
    ).rejects.toMatchObject({ code: "RELATION_REJECTED", status: 409 });
    await expect(client.contacts.restore({ id: contact.id })).resolves.toEqual({ ok: true });
    await expect(
      client.contacts.removeTag({ contactId: contact.id, resourceId: tag.id }),
    ).resolves.toEqual({ ok: true });
  });

  it("reserves a delivery idempotency key only once", async () => {
    const { workspaceId } = await seedWorkspace(env.DB);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const idempotency = new IdempotencyRepository(env.DB);
    expect(await idempotency.reserve(workspaceId, "delivery", "same-key", expiresAt)).toBe(true);
    expect(await idempotency.reserve(workspaceId, "delivery", "same-key", expiresAt)).toBe(false);
  });

  it("requires admin to archive an email template or variable even though marketer can create them", async () => {
    const { client } = await seedWorkspaceClient(env.DB, { role: "marketer" });

    const variable = await client.emails.createVariable({
      key: "brand_name",
      name: "Brand name",
      value: "OpenEngage",
      description: "Shared brand label",
    });
    const template = await client.emails.createTemplate({
      name: "Welcome",
      purpose: "transactional",
      subject: "Welcome {{ contact.first_name }}",
      content: {
        schemaVersion: 2 as const,
        previewText: "",
        theme: {
          backgroundColor: "#f4f5f7",
          surfaceColor: "#ffffff",
          textColor: "#171717",
          mutedTextColor: "#64748b",
          accentColor: "#171717",
          fontFamily: "sans" as const,
          width: 600,
        },
        blocks: [{ id: "body", type: "markdown" as const, markdown: "Hello" }],
      },
    });

    await expect(client.emails.archiveTemplate({ id: template.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(client.emails.archiveVariable({ id: variable.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("requires managed brand details before publishing a marketing email", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const template = await client.emails.createTemplate({
      name: "Newsletter",
      purpose: "marketing",
      subject: "今月のお知らせ",
      content: {
        schemaVersion: 2,
        previewText: "今月の更新情報",
        theme: {
          backgroundColor: "#f4f5f7",
          surfaceColor: "#ffffff",
          textColor: "#171717",
          mutedTextColor: "#64748b",
          accentColor: "#171717",
          fontFamily: "sans",
          width: 600,
        },
        blocks: [{ id: "body", type: "markdown", markdown: "# 今月のお知らせ" }],
      },
    });

    await expect(client.emails.publishTemplate({ id: template.id })).rejects.toMatchObject({
      code: "MARKETING_BRAND_INCOMPLETE",
    });
    await client.workspace.updateEmailBrand({
      brandName: "OpenEngage",
      companyDescription: "Customer engagement platform",
      tone: "簡潔で親しみやすい",
      logoAssetId: null,
      websiteUrl: "https://example.com",
      primaryColor: "#171717",
      backgroundColor: "#f4f5f7",
      textColor: "#171717",
      postalAddress: "東京都千代田区1-1",
    });
    await expect(client.emails.publishTemplate({ id: template.id })).resolves.toEqual({ ok: true });
    expect(
      (await client.emails.listTemplates({ archived: false })).find(
        (item) => item.id === template.id,
      ),
    ).toMatchObject({ purpose: "marketing", publishedRevision: 1, sendable: false });
  });
});
