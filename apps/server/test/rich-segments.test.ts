import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { compileSegmentFilter, segmentFilterSchema } from "@openengage/core/segments";

import { seedWorkspaceClient } from "./factory";

it("selects category-qualified recent form respondents without an open deal and expires with time", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const contact = await client.contacts.create({ email: "rich@example.com" });
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO scoring_categories(id,workspace_id,name,slug,created_at,updated_at) VALUES('cat-' || ?,?,'Product','product',?,?)",
  )
    .bind(workspaceId, workspaceId, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO contact_category_scores(workspace_id,contact_id,category_id,score,updated_at) VALUES(?,?,'cat-' || ?,50,?)",
  )
    .bind(workspaceId, contact.id, workspaceId, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO contact_events(id,workspace_id,contact_id,type,resource_type,resource_id,properties,occurred_at,created_at) VALUES('event-' || ?,?,?,'form_submitted','form','download','{\"plan\":\"pro\"}',?,?)",
  )
    .bind(workspaceId, workspaceId, contact.id, now, now)
    .run();
  const filter = segmentFilterSchema.parse({
    kind: "group",
    combinator: "and",
    children: [
      {
        kind: "condition",
        field: "category_score",
        key: `cat-${workspaceId}`,
        operator: "gte",
        value: 50,
      },
      {
        kind: "group",
        combinator: "and",
        relation: "event",
        minimumCount: 1,
        children: [
          { kind: "condition", field: "event_type", operator: "eq", value: "form_submitted" },
          { kind: "condition", field: "event_resource_id", operator: "eq", value: "download" },
          { kind: "condition", field: "event_age_minutes", operator: "lte", value: 60 },
          { kind: "condition", field: "event_property", key: "plan", operator: "eq", value: "pro" },
        ],
      },
      {
        kind: "group",
        combinator: "and",
        relation: "deal",
        negated: true,
        children: [{ kind: "condition", field: "deal_status", operator: "eq", value: "open" }],
      },
    ],
  });
  async function matches() {
    const compiled = compileSegmentFilter(workspaceId, filter);
    return (
      await env.DB.prepare(compiled.sql)
        .bind(...compiled.params)
        .all()
    ).results;
  }
  expect(await matches()).toHaveLength(1);
  await env.DB.prepare(
    "UPDATE contact_events SET occurred_at='2000-01-01T00:00:00.000Z' WHERE id='event-' || ?",
  )
    .bind(workspaceId)
    .run();
  expect(await matches()).toHaveLength(0);
  await env.DB.prepare("UPDATE contact_events SET occurred_at=? WHERE id='event-' || ?")
    .bind(now, workspaceId)
    .run();
  const pipeline = (await client.deals.options()).pipelines[0]!;
  await client.deals.create({
    name: "Open",
    pipelineId: pipeline.id,
    stageId: pipeline.stages[0]!.id,
    contactId: contact.id,
  });
  expect(await matches()).toHaveLength(0);
});

it("keeps deal conditions on one related row", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const contact = await client.contacts.create({ email: "same-row@example.com" });
  const pipeline = (await client.deals.options()).pipelines[0]!;
  const base = { pipelineId: pipeline.id, stageId: pipeline.stages[0]!.id, contactId: contact.id };
  await client.deals.create({ ...base, name: "Small open", value: 1 });
  await client.deals.create({ ...base, name: "Large lost", value: 1000, status: "lost" });
  const filter = segmentFilterSchema.parse({
    kind: "group",
    relation: "deal",
    combinator: "and",
    children: [
      { kind: "condition", field: "deal_status", operator: "eq", value: "open" },
      { kind: "condition", field: "deal_value", operator: "gte", value: 100 },
    ],
  });
  const compiled = compileSegmentFilter(workspaceId, filter);
  expect(
    (
      await env.DB.prepare(compiled.sql)
        .bind(...compiled.params)
        .all()
    ).results,
  ).toHaveLength(0);
});

it("keeps company custom-field predicates on the same company", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const contact = await client.contacts.create({ email: "company-rows@example.com" });
  const now = new Date().toISOString();
  for (const [id, fields] of [
    [`small-${workspaceId}`, { country: "JP", size: 1 }],
    [`large-${workspaceId}`, { country: "US", size: 1000 }],
  ] as const) {
    await env.DB.prepare(
      "INSERT INTO companies(id,workspace_id,name,custom_fields,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(id, workspaceId, id, JSON.stringify(fields), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO company_contacts(workspace_id,company_id,contact_id,created_at) VALUES(?,?,?,?)",
    )
      .bind(workspaceId, id, contact.id, now)
      .run();
  }
  const filter = segmentFilterSchema.parse({
    kind: "group",
    relation: "company",
    combinator: "and",
    children: [
      {
        kind: "condition",
        field: "company_custom_field",
        key: "country",
        operator: "eq",
        value: "JP",
      },
      {
        kind: "condition",
        field: "company_custom_field",
        key: "size",
        operator: "gte",
        value: 100,
      },
    ],
  });
  const compiled = compileSegmentFilter(workspaceId, filter);
  expect(
    (
      await env.DB.prepare(compiled.sql)
        .bind(...compiled.params)
        .all()
    ).results,
  ).toHaveLength(0);
});

it("validates advertised stage unary predicates and custom value types before SQL compilation", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  for (const operator of ["exists", "not_exists"] as const)
    expect(
      await client.segments.validate({
        filter: { kind: "condition", field: "deal_stage_id", operator, value: null },
      }),
    ).toMatchObject({ valid: true });
  const invalid = await client.segments.validate({
    filter: {
      kind: "condition",
      field: "event_property",
      key: "amount",
      operator: "eq",
      value: [1, 2],
    },
  });
  expect(invalid.valid).toBe(false);
});
