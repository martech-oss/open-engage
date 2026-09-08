import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { seedWorkspaceClient } from "./factory";

describe("campaign costs and lifecycle cohorts", () => {
  it("keeps currencies separate, computes ROI and preserves a zero-cost null", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const project = await client.projects.create({ name: "ROI" });
    const empty = await client.projects.create({ name: "No cost" });
    const costId = crypto.randomUUID();
    await client.projects.createCost({
      id: project.id,
      costId,
      bookedOn: "2026-01-05",
      category: "広告",
      amount: 100,
      currency: "JPY",
    });
    await client.projects.createCost({
      id: project.id,
      costId: crypto.randomUUID(),
      bookedOn: "2026-01-05",
      category: "広告",
      amount: 999,
      currency: "USD",
    });
    const contact = await client.contacts.create({ email: "roi@example.com", customFields: {} });
    const { pipelines } = await client.deals.options();
    const pipeline = pipelines[0]!;
    for (const currency of ["JPY", "USD"]) {
      const deal = await client.deals.create({
        name: currency,
        contactId: contact.id,
        value: 400,
        currency,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0]!.id,
      });
      await env.DB.prepare(
        "UPDATE deals SET status='won',won_at='2026-01-20T00:00:00.000Z' WHERE id=?",
      )
        .bind(deal.id)
        .run();
    }
    await env.DB.prepare(
      "INSERT INTO campaign_touches(id,workspace_id,project_id,contact_id,resource_type,resource_id,event_type,occurred_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        workspaceId,
        project.id,
        contact.id,
        "form",
        "test",
        "form_submitted",
        "2026-01-10T00:00:00.000Z",
        "2026-01-10T00:00:00.000Z",
      )
      .run();
    const report = await client.reports.campaigns({
      from: "2026-01-01",
      to: "2026-01-31",
      currency: "JPY",
    });
    expect(report.attributionModel).toBe("last_touch");
    expect(report.campaigns.find((row) => row.id === project.id)).toMatchObject({
      cost: 100,
      attributedValue: 400,
      roi: 300,
    });
    expect(report.campaigns.find((row) => row.id === empty.id)?.roi).toBeNull();
    const other = await seedWorkspaceClient(env.DB);
    await expect(other.client.projects.listCosts({ id: project.id })).rejects.toThrow();
    await client.projects.updateCost({
      id: project.id,
      costId,
      bookedOn: "2026-02-05",
      category: "広告",
      amount: 100,
      currency: "JPY",
    });
    expect(
      (await client.reports.campaigns({ from: "2026-01-01", to: "2026-01-31", currency: "JPY" }))
        .summary.cost,
    ).toBe(0);
  });

  it("uses first real arrivals, separates skipped stages, and computes medians", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    for (let i = 0; i < 3; i++) {
      const contact = await client.contacts.create({
        email: `cohort${i}@example.com`,
        customFields: {},
      });
      await env.DB.prepare("UPDATE contacts SET created_at='2026-01-01T01:00:00.000Z' WHERE id=?")
        .bind(contact.id)
        .run();
      const stages =
        i === 2
          ? [
              ["sql", 5],
              ["customer", 7],
            ]
          : [
              ["mql", i + 2],
              ["sql", i + 5],
              ["customer", i + 7],
            ];
      for (const [stage, day] of stages)
        await env.DB.prepare(
          "INSERT INTO contact_lifecycle_history(workspace_id,contact_id,stage,reached_at,source) VALUES(?,?,?,?,?)",
        )
          .bind(
            workspaceId,
            contact.id,
            stage,
            `2026-01-${String(day).padStart(2, "0")}T01:00:00.000Z`,
            "test",
          )
          .run();
    }
    const report = await client.reports.lifecycle({ from: "2026-01-01", to: "2026-01-02" });
    expect(report.summary).toMatchObject({
      leads: 3,
      mql: 2,
      sql: 3,
      customer: 3,
      skippedMql: 1,
      skippedSql: 0,
      medianLeadToMqlDays: 1.5,
      medianMqlToSqlDays: 3,
      medianSqlToCustomerDays: 2,
    });
    expect(report.cohorts.find((row) => row.day === "2026-01-01")?.mqlRate).toBeCloseTo(66.67);
  });
});

it("allocates one won deal to distinct first and last projects without summing influenced revenue", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB, { timezone: "Asia/Tokyo" });
  const first = await client.projects.create({ name: "First touch" }),
    last = await client.projects.create({ name: "Last touch" });
  const contact = await client.contacts.create({
    email: "two-touches@example.com",
    customFields: {},
  });
  const { pipelines } = await client.deals.options(),
    pipeline = pipelines[0]!;
  const deal = await client.deals.create({
    name: "Won",
    contactId: contact.id,
    value: 500,
    currency: "JPY",
    pipelineId: pipeline.id,
    stageId: pipeline.stages[0]!.id,
  });
  await env.DB.prepare("UPDATE deals SET status='won',won_at='2026-01-31T15:00:00.000Z' WHERE id=?")
    .bind(deal.id)
    .run();
  for (const [project, at] of [
    [first, "2025-12-01T00:00:00.000Z"],
    [last, "2026-01-01T00:00:00.000Z"],
  ] as const) {
    await env.DB.prepare(
      "INSERT INTO campaign_touches(id,workspace_id,project_id,contact_id,resource_type,resource_id,event_type,occurred_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        workspaceId,
        project.id,
        contact.id,
        "form",
        "fixture",
        "form_submitted",
        at,
        at,
      )
      .run();
    await client.projects.createCost({
      id: project.id,
      costId: crypto.randomUUID(),
      bookedOn: "2026-02-01",
      category: "広告",
      currency: "JPY",
      amount: 100,
    });
  }
  for (const model of ["first_touch", "last_touch"] as const) {
    const report = await client.reports.campaigns({
      from: "2026-02-01",
      to: "2026-02-01",
      currency: "JPY",
      attributionModel: model,
    });
    expect(report.summary.attributedValue).toBe(500);
    expect(
      report.campaigns.find((row) => row.id === (model === "first_touch" ? first.id : last.id)),
    ).toMatchObject({ attributedValue: 500, roi: 400 });
    expect(
      report.campaigns.find((row) => row.id === (model === "first_touch" ? last.id : first.id)),
    ).toMatchObject({ attributedValue: 0, roi: -100 });
  }
  expect(
    (await client.reports.campaigns({ from: "2026-01-31", to: "2026-01-31", currency: "JPY" }))
      .summary.attributedValue,
  ).toBe(0);
});
