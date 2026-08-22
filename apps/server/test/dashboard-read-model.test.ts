import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase, uuidv7 } from "@openengage/database/testing";

import { getDashboard } from "../src/reports/dashboard-service";
import { seedWorkspace } from "./factory";

const AS_OF = "2026-01-15T12:00:00.000Z";

describe("dashboard read model", () => {
  it("returns zero-filled fixed windows at the workspace-local date boundary", async () => {
    const { workspaceId } = await seedWorkspace(env.DB, {
      timezone: "America/Los_Angeles",
    });

    const dashboard = await getDashboard(env.DB, workspaceId, {
      now: "2026-01-02T01:30:00.000Z",
    });

    expect(dashboard).toMatchObject({
      asOf: "2026-01-02T01:30:00.000Z",
      timezone: "America/Los_Angeles",
      contacts: {
        count: 0,
        trend: { from: "2025-12-19", to: "2026-01-01" },
        changePercent: null,
      },
      automations: { count: 0, draftCount: 0, enrolledCount: 0, top: [] },
      deliveries: {
        sent: 0,
        delivered: 0,
        failed: 0,
        deliveryRate: 0,
        totalsRange: { from: "2025-12-03", to: "2026-01-01" },
        health: { from: "2025-12-19", to: "2026-01-01" },
        sendChangePercent: null,
        deliveryRateChangePoints: null,
      },
      deals: {
        range: { from: "2025-12-03", to: "2026-01-01" },
        currency: "JPY",
        created: 0,
        openCount: 0,
        openValue: 0,
        averageOpenValue: 0,
        openTasks: 0,
        overdueTasks: 0,
        completedTasks: 0,
      },
      briefs: { overdueReviews: 0 },
      recentEvents: [],
      recentActivity: [],
    });
    expect(dashboard.contacts.trend.points).toHaveLength(14);
    expect(dashboard.contacts.trend.points).toEqual(
      expect.arrayContaining([
        { day: "2025-12-19", added: 0 },
        { day: "2026-01-01", added: 0 },
      ]),
    );
    expect(dashboard.deliveries.health.points).toHaveLength(14);
  });

  it("uses workspace-local midnight for persisted contact and delivery trend membership", async () => {
    const { workspaceId } = await seedWorkspace(env.DB, {
      timezone: "America/Los_Angeles",
    });
    const beforeBoundary = "2025-12-19T07:59:59.999Z";
    const atBoundary = "2025-12-19T08:00:00.000Z";
    const contactIds = [uuidv7(), uuidv7()];
    const deliveryIds = [uuidv7(), uuidv7()];
    await env.DB.batch([
      ...contactIds.map((id, index) => {
        const createdAt = index === 0 ? beforeBoundary : atBoundary;
        return env.DB.prepare(
          `INSERT INTO contacts
           (id, workspace_id, email, stage, score, status, custom_fields, created_at, updated_at)
           VALUES (?, ?, ?, 'lead', 0, 'active', '{}', ?, ?)`,
        ).bind(id, workspaceId, `boundary-${index}@example.com`, createdAt, createdAt);
      }),
      ...deliveryIds.map((id, index) => {
        const createdAt = index === 0 ? beforeBoundary : atBoundary;
        return env.DB.prepare(
          `INSERT INTO deliveries
           (id, workspace_id, contact_id, channel, purpose, provider, recipient,
            idempotency_key, payload, status, attempts, created_at, updated_at)
           VALUES (?, ?, ?, 'email', 'marketing', 'cloudflare', 'boundary@example.com',
                   ?, '{}', 'delivered', 1, ?, ?)`,
        ).bind(id, workspaceId, contactIds[index], `boundary-${id}`, createdAt, createdAt);
      }),
    ]);

    // 08:00Z is midnight in Los Angeles on Dec 19. The record one millisecond
    // earlier belongs to Dec 18 and is outside the 14-day Dec 19-Jan 1 window.
    const dashboard = await getDashboard(env.DB, workspaceId, {
      now: "2026-01-02T01:30:00.000Z",
    });

    expect(dashboard.contacts.count).toBe(2);
    expect(dashboard.contacts.trend.points.find((point) => point.day === "2025-12-19")).toEqual({
      day: "2025-12-19",
      added: 1,
    });
    expect(dashboard.deliveries.health.points.find((point) => point.day === "2025-12-19")).toEqual({
      day: "2025-12-19",
      sends: 1,
      delivered: 1,
      undelivered: 0,
    });
  });

  it("labels Tokyo early-hour activity with the workspace calendar day", async () => {
    const { workspaceId } = await seedWorkspace(env.DB, { timezone: "Asia/Tokyo" });
    const contactId = uuidv7();
    const at = "2026-08-22T15:30:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO contacts
         (id, workspace_id, email, stage, score, status, custom_fields, created_at, updated_at)
         VALUES (?, ?, 'tokyo-early@example.com', 'lead', 0, 'active', '{}', ?, ?)`,
      ).bind(contactId, workspaceId, at, at),
      env.DB.prepare(
        `INSERT INTO deliveries
         (id, workspace_id, contact_id, channel, purpose, provider, recipient,
          idempotency_key, payload, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, 'email', 'marketing', 'cloudflare', 'tokyo@example.com',
                 ?, '{}', 'delivered', 1, ?, ?)`,
      ).bind(uuidv7(), workspaceId, contactId, `tokyo-${contactId}`, at, at),
    ]);

    const dashboard = await getDashboard(env.DB, workspaceId, {
      now: "2026-08-23T03:00:00.000Z",
    });

    expect(dashboard.contacts.trend.points.find((point) => point.day === "2026-08-23")).toEqual({
      day: "2026-08-23",
      added: 1,
    });
    expect(dashboard.deliveries.health.points.find((point) => point.day === "2026-08-23")).toEqual({
      day: "2026-08-23",
      sends: 1,
      delivered: 1,
      undelivered: 0,
    });
  });

  it("calculates populated dashboard totals, changes, rankings, and limits", async () => {
    const { workspaceId, userId } = await seedWorkspace(env.DB, { timezone: "UTC" });
    await seedDashboardData(workspaceId, userId);

    const dashboard = await getDashboard(createDatabase(env.DB), workspaceId, { now: AS_OF });

    expect(dashboard.contacts).toMatchObject({ count: 4, changePercent: 200 });
    expect(dashboard.contacts.trend.points.filter((point) => point.added > 0)).toEqual([
      { day: "2026-01-05", added: 1 },
      { day: "2026-01-12", added: 3 },
    ]);
    expect(dashboard.deliveries).toMatchObject({
      sent: 7,
      delivered: 5,
      failed: 2,
      deliveryRate: 71.4,
      sendChangePercent: 100,
      deliveryRateChangePoints: 25,
    });
    expect(dashboard.deliveries.health.points.filter((point) => point.sends > 0)).toEqual([
      { day: "2026-01-05", sends: 2, delivered: 1, undelivered: 1 },
      { day: "2026-01-12", sends: 4, delivered: 3, undelivered: 1 },
    ]);
    expect(dashboard.automations).toMatchObject({
      count: 7,
      draftCount: 1,
      enrolledCount: 1,
    });
    expect(dashboard.automations.top).toHaveLength(6);
    expect(dashboard.automations.top[0]).toEqual(
      expect.objectContaining({
        name: "Active flow",
        active: 1,
        completed: 1,
        updatedAt: "2026-01-14T12:00:00.000Z",
      }),
    );
    expect(dashboard.deals).toMatchObject({
      currency: "JPY",
      created: 1,
      openCount: 1,
      openValue: 200_000,
      averageOpenValue: 200_000,
      openTasks: 1,
      overdueTasks: 1,
      completedTasks: 1,
    });
    expect(dashboard.briefs.overdueReviews).toBe(1);
    expect(dashboard.recentEvents).toHaveLength(20);
    expect(dashboard.recentEvents[0]).toMatchObject({ type: "event_20" });
    expect(dashboard.recentActivity).toHaveLength(12);
    expect(dashboard.recentActivity[0]).toMatchObject({ type: "event_20" });
  });
});

async function seedDashboardData(workspaceId: string, userId: string): Promise<void> {
  const contactIds = Array.from({ length: 4 }, () => uuidv7());
  const automationId = uuidv7();
  const draftAutomationId = uuidv7();
  const versionId = uuidv7();
  const pipelineId = uuidv7();
  const stageId = uuidv7();
  const dealId = uuidv7();
  const projectId = uuidv7();
  const approverUserId = uuidv7();
  const contactValues = [
    [contactIds[0], "previous@example.com", "2026-01-05T12:00:00.000Z"],
    [contactIds[1], "current-1@example.com", "2026-01-12T01:00:00.000Z"],
    [contactIds[2], "current-2@example.com", "2026-01-12T02:00:00.000Z"],
    [contactIds[3], "current-3@example.com", "2026-01-12T03:00:00.000Z"],
  ] as const;
  const deliveryValues = [
    ["2025-12-20T12:00:00.000Z", "delivered"],
    ["2026-01-05T01:00:00.000Z", "delivered"],
    ["2026-01-05T02:00:00.000Z", "failed"],
    ["2026-01-12T01:00:00.000Z", "delivered"],
    ["2026-01-12T02:00:00.000Z", "delivered"],
    ["2026-01-12T03:00:00.000Z", "delivered"],
    ["2026-01-12T04:00:00.000Z", "failed"],
  ] as const;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user
       (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, 'Approver', ?, 1, ?, ?)`,
    ).bind(approverUserId, `${approverUserId}@example.com`, Date.now(), Date.now()),
    ...contactValues.map(([id, email, createdAt]) =>
      env.DB.prepare(
        `INSERT INTO contacts
         (id, workspace_id, email, stage, score, status, custom_fields, created_at, updated_at)
         VALUES (?, ?, ?, 'lead', 0, 'active', '{}', ?, ?)`,
      ).bind(id, workspaceId, email, createdAt, createdAt),
    ),
    env.DB.prepare(
      `INSERT INTO automations
       (id, workspace_id, name, description, status, created_at, updated_at)
       VALUES (?, ?, 'Active flow', '', 'active', ?, ?)`,
    ).bind(automationId, workspaceId, AS_OF, "2026-01-14T12:00:00.000Z"),
    env.DB.prepare(
      `INSERT INTO automations
       (id, workspace_id, name, description, status, created_at, updated_at)
       VALUES (?, ?, 'Draft flow', '', 'draft', ?, ?)`,
    ).bind(draftAutomationId, workspaceId, AS_OF, AS_OF),
    ...Array.from({ length: 6 }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO automations
         (id, workspace_id, name, description, status, created_at, updated_at)
         VALUES (?, ?, ?, '', 'active', ?, ?)`,
      ).bind(
        uuidv7(),
        workspaceId,
        `Idle flow ${index}`,
        AS_OF,
        `2026-01-0${index + 1}T12:00:00.000Z`,
      ),
    ),
    env.DB.prepare(
      `INSERT INTO automation_versions
       (id, workspace_id, automation_id, version, status, timezone, graph, created_at)
       VALUES (?, ?, ?, 1, 'published', 'UTC', '{"nodes":[],"edges":[]}', ?)`,
    ).bind(versionId, workspaceId, automationId, AS_OF),
    env.DB.prepare(
      `INSERT INTO automation_enrollments
       (id, workspace_id, automation_id, automation_version_id, contact_id, status, entered_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(uuidv7(), workspaceId, automationId, versionId, contactIds[0], AS_OF, AS_OF),
    env.DB.prepare(
      `INSERT INTO automation_enrollments
       (id, workspace_id, automation_id, automation_version_id, contact_id, status, entered_at, completed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
    ).bind(uuidv7(), workspaceId, automationId, versionId, contactIds[1], AS_OF, AS_OF, AS_OF),
    ...deliveryValues.map(([createdAt, status]) => {
      const id = uuidv7();
      return env.DB.prepare(
        `INSERT INTO deliveries
         (id, workspace_id, contact_id, channel, purpose, provider, recipient,
          idempotency_key, payload, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, 'email', 'marketing', 'cloudflare', 'recipient@example.com',
                 ?, '{}', ?, 1, ?, ?)`,
      ).bind(id, workspaceId, contactIds[0], `dashboard-${id}`, status, createdAt, createdAt);
    }),
    env.DB.prepare(
      `INSERT INTO deal_pipelines
       (id, workspace_id, name, is_default, created_at, updated_at)
       VALUES (?, ?, 'Sales', 1, ?, ?)`,
    ).bind(pipelineId, workspaceId, AS_OF, AS_OF),
    env.DB.prepare(
      `INSERT INTO deal_stages
       (id, workspace_id, pipeline_id, name, color, position, probability, created_at, updated_at)
       VALUES (?, ?, ?, 'Proposal', '#64748b', 0, 50, ?, ?)`,
    ).bind(stageId, workspaceId, pipelineId, AS_OF, AS_OF),
    env.DB.prepare(
      `INSERT INTO deals
       (id, workspace_id, pipeline_id, stage_id, name, value, currency, status,
        owner_user_id, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Open deal', 200000, 'JPY', 'open', ?, '', ?, ?)`,
    ).bind(dealId, workspaceId, pipelineId, stageId, userId, "2026-01-10T12:00:00.000Z", AS_OF),
    env.DB.prepare(
      `INSERT INTO deal_tasks
       (id, workspace_id, deal_id, type, title, notes, due_at, status,
        assigned_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'task', 'Overdue', '', '2026-01-01T00:00:00.000Z', 'open', ?, ?, ?)`,
    ).bind(uuidv7(), workspaceId, dealId, userId, AS_OF, AS_OF),
    env.DB.prepare(
      `INSERT INTO deal_tasks
       (id, workspace_id, deal_id, type, title, notes, status, completed_at,
        assigned_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'task', 'Done', '', 'completed', '2026-01-10T00:00:00.000Z', ?, ?, ?)`,
    ).bind(uuidv7(), workspaceId, dealId, userId, AS_OF, AS_OF),
    env.DB.prepare(
      `INSERT INTO projects
       (id, workspace_id, name, description, color, created_at, updated_at)
       VALUES (?, ?, 'Campaign', '', '#64748b', ?, ?)`,
    ).bind(projectId, workspaceId, AS_OF, AS_OF),
    env.DB.prepare(
      `INSERT INTO project_briefs
       (project_id, workspace_id, status, revision, row_version, owner_user_id,
        approver_user_id, primary_motion, review_at, definition, approved_at,
        approved_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'approved', 1, 1, ?, ?, 'acquisition', '2026-01-01T00:00:00.000Z',
               '{}', ?, ?, ?, ?)`,
    ).bind(projectId, workspaceId, userId, approverUserId, AS_OF, approverUserId, AS_OF, AS_OF),
    ...Array.from({ length: 21 }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO contact_events
         (id, workspace_id, contact_id, type, properties, occurred_at, created_at)
         VALUES (?, ?, ?, ?, '{}', ?, ?)`,
      ).bind(
        uuidv7(),
        workspaceId,
        contactIds[0],
        `event_${String(index).padStart(2, "0")}`,
        `2026-01-14T${String(index).padStart(2, "0")}:00:00.000Z`,
        AS_OF,
      ),
    ),
  ]);
}
