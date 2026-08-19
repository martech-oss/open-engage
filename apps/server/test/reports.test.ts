import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  contactEvents,
  contacts as contactsTable,
  createDatabase,
  uuidv7,
} from "@openengage/database/testing";

import { seedMember, seedWorkspaceClient } from "./factory";

describe("Reporting", () => {
  it("aggregates contacts, automations, emails, deals, and site activity", async () => {
    const contactId = uuidv7();
    const archivedContactId = uuidv7();
    const automationId = uuidv7();
    const automationVersionId = uuidv7();
    const enrollmentId = uuidv7();
    const deliveryId = uuidv7();
    const pipelineId = uuidv7();
    const stageId = uuidv7();
    const wonDealId = uuidv7();
    const openDealId = uuidv7();
    const formId = uuidv7();
    const at = "2026-07-15T03:00:00.000Z";
    const completedAt = "2026-07-20T03:00:00.000Z";
    const { client, workspaceId, userId } = await seedWorkspaceClient(env.DB, {
      role: "analyst",
      timezone: "Asia/Tokyo",
    });
    await seedMember(env.DB, { workspaceId, userId, role: "analyst" });
    const orm = createDatabase(env.DB).orm;
    await orm.insert(contactsTable).values([
      {
        id: contactId,
        workspaceId,
        email: "active@example.com",
        stage: "lead",
        score: 10,
        status: "active",
        customFields: "{}",
        createdAt: at,
        updatedAt: at,
      },
      {
        id: archivedContactId,
        workspaceId,
        email: "archived@example.com",
        stage: "lead",
        score: 0,
        status: "archived",
        customFields: "{}",
        createdAt: at,
        updatedAt: completedAt,
        archivedAt: completedAt,
      },
    ]);
    await orm.insert(contactEvents).values([
      {
        id: uuidv7(),
        workspaceId,
        contactId,
        visitorId: "visitor-1",
        type: "page_viewed",
        resourceType: "page",
        resourceId: "https://example.com/pricing",
        properties: "{}",
        occurredAt: at,
        createdAt: at,
      },
      {
        id: uuidv7(),
        workspaceId,
        contactId,
        visitorId: "visitor-1",
        type: "page_viewed",
        resourceType: "page",
        resourceId: "https://example.com/pricing",
        properties: "{}",
        occurredAt: completedAt,
        createdAt: completedAt,
      },
    ]);
    // raw seed: migrate in P6/P7 (deliveries, deals, webforms, site messages)
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO automations
         (id, workspace_id, name, description, status, created_at, updated_at)
         VALUES (?, ?, 'Welcome flow', '', 'active', ?, ?)`,
      ).bind(automationId, workspaceId, at, at),
      env.DB.prepare(
        `INSERT INTO automation_versions
         (id, workspace_id, automation_id, version, status, timezone, graph, published_at, created_at)
         VALUES (?, ?, ?, 1, 'published', 'Asia/Tokyo', '{"nodes":[],"edges":[]}', ?, ?)`,
      ).bind(automationVersionId, workspaceId, automationId, at, at),
      env.DB.prepare(
        `INSERT INTO automation_enrollments
         (id, workspace_id, automation_id, automation_version_id, contact_id, status,
          entered_at, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      ).bind(
        enrollmentId,
        workspaceId,
        automationId,
        automationVersionId,
        contactId,
        at,
        completedAt,
        completedAt,
      ),
      env.DB.prepare(
        `INSERT INTO deliveries
         (id, workspace_id, contact_id, enrollment_id, channel, purpose, provider,
          recipient, idempotency_key, payload, status, provider_message_id,
          attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'email', 'marketing', 'cloudflare', 'active@example.com',
                 ?, '{}', 'delivered', ?, 1, ?, ?)`,
      ).bind(
        deliveryId,
        workspaceId,
        contactId,
        enrollmentId,
        `report-${deliveryId}`,
        `provider-${deliveryId}`,
        at,
        completedAt,
      ),
      ...["delivered", "opened", "clicked"].map((type, index) =>
        env.DB.prepare(
          `INSERT INTO delivery_events
           (id, workspace_id, delivery_id, provider, provider_event_id,
            provider_message_id, type, occurred_at, metadata, created_at)
           VALUES (?, ?, ?, 'cloudflare', ?, ?, ?, ?, '{}', ?)`,
        ).bind(
          uuidv7(),
          workspaceId,
          deliveryId,
          `${deliveryId}-${type}`,
          `provider-${deliveryId}`,
          type,
          `2026-07-${String(16 + index).padStart(2, "0")}T03:00:00.000Z`,
          at,
        ),
      ),
      env.DB.prepare(
        `INSERT INTO deal_pipelines
         (id, workspace_id, name, is_default, created_at, updated_at)
         VALUES (?, ?, 'Sales', 1, ?, ?)`,
      ).bind(pipelineId, workspaceId, at, at),
      env.DB.prepare(
        `INSERT INTO deal_stages
         (id, workspace_id, pipeline_id, name, color, position, probability, created_at, updated_at)
         VALUES (?, ?, ?, 'Proposal', '#8b5cf6', 0, 50, ?, ?)`,
      ).bind(stageId, workspaceId, pipelineId, at, at),
      env.DB.prepare(
        `INSERT INTO deals
         (id, workspace_id, pipeline_id, stage_id, name, value, currency, status,
          owner_user_id, description, won_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Won deal', 100000, 'JPY', 'won', ?, '', ?, ?, ?)`,
      ).bind(wonDealId, workspaceId, pipelineId, stageId, userId, completedAt, at, completedAt),
      env.DB.prepare(
        `INSERT INTO deals
         (id, workspace_id, pipeline_id, stage_id, name, value, currency, status,
          owner_user_id, expected_close_date, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Open deal', 200000, 'JPY', 'open', ?,
                 '2026-07-28', '', ?, ?)`,
      ).bind(openDealId, workspaceId, pipelineId, stageId, userId, at, at),
      env.DB.prepare(
        `INSERT INTO deal_tasks
         (id, workspace_id, deal_id, type, title, notes, due_at, status,
          assigned_user_id, created_at, updated_at)
         VALUES (?, ?, ?, 'call', 'Follow up', '', '2026-07-01T00:00:00.000Z',
                 'open', ?, ?, ?)`,
      ).bind(uuidv7(), workspaceId, openDealId, userId, at, at),
      env.DB.prepare(
        `INSERT INTO forms
         (id, workspace_id, name, slug, status, version, definition,
          allowed_domains, turnstile_enabled, success_message, created_at, updated_at)
         VALUES (?, ?, 'Newsletter', 'newsletter', 'published', 1, '{}',
                 '[]', 0, 'Thanks', ?, ?)`,
      ).bind(formId, workspaceId, at, at),
      env.DB.prepare(
        `INSERT INTO form_submissions
         (id, workspace_id, form_id, contact_id, idempotency_key, payload, created_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?)`,
      ).bind(uuidv7(), workspaceId, formId, contactId, `form-${uuidv7()}`, at),
      env.DB.prepare(
        `INSERT INTO site_messages
         (id, workspace_id, name, status, headline, body, cta_label,
          page_pattern, impression_count, click_count, created_at, updated_at)
         VALUES (?, ?, 'Pricing CTA', 'published', 'Talk to sales', '', 'Contact',
                 '/pricing*', 10, 2, ?, ?)`,
      ).bind(uuidv7(), workspaceId, at, at),
    ]);

    const range = { from: "2026-07-01", to: "2026-07-31" };

    const contacts = await client.reports.contacts(range);
    expect(contacts).toMatchObject({
      category: "contacts",
      summary: {
        totalContacts: 2,
        activeContacts: 1,
        newContacts: 2,
        archivedContacts: 1,
      },
    });

    const automations = await client.reports.automations(range);
    expect(automations).toMatchObject({
      category: "automations",
      summary: {
        automationCount: 1,
        entries: 1,
        completions: 1,
        completionRate: 100,
        openRate: 100,
        clickRate: 100,
      },
    });

    const emails = await client.reports.emails(range);
    expect(emails).toMatchObject({
      category: "emails",
      summary: {
        sends: 1,
        delivered: 1,
        opens: 1,
        clicks: 1,
        deliveryRate: 100,
        openRate: 100,
      },
    });

    const deals = await client.reports.deals({ ...range, currency: "JPY" });
    expect(deals).toMatchObject({
      category: "deals",
      currency: "JPY",
      summary: {
        created: 2,
        won: 1,
        wonValue: 100_000,
        openCount: 1,
        openValue: 200_000,
        overdueTasks: 1,
      },
    });

    const site = await client.reports.site(range);
    expect(site).toMatchObject({
      category: "site",
      summary: {
        pageViews: 2,
        uniqueVisitors: 1,
        identifiedContacts: 1,
        identificationRate: 100,
        submissions: 1,
        messageImpressions: 10,
        messageClicks: 2,
      },
    });

    // The range refine (366-day cap) rejects during input validation; the
    // REST route surfaced this as 422 while oRPC reports BAD_REQUEST.
    await expect(
      client.reports.contacts({ from: "2025-01-01", to: "2026-07-31" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
