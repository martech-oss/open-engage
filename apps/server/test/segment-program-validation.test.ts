import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import type { AutomationDefinition } from "@openengage/core/automations";
import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { segmentFilterSchema, type SegmentFilter } from "@openengage/core/segments";
import { createDatabase } from "@openengage/database/client";

import {
  loadAutomationResourceContext,
  validateAutomationResources,
} from "../src/automations/resource-validation";
import { validateSegmentFilter } from "../src/segments/validation-service";
import { programFixture } from "./program-test-support";

function statusFilter(
  projectId: string,
  definitionVersion = 1,
  value: string | string[] = ["registered", "attended"],
  operator: "eq" | "neq" | "in" = Array.isArray(value) ? "in" : "eq",
): SegmentFilter {
  return segmentFilterSchema.parse({
    kind: "group",
    relation: "project_member",
    combinator: "and",
    children: [
      {
        kind: "group",
        combinator: "or",
        children: [
          {
            kind: "condition",
            field: "project_status",
            operator,
            value,
            program: { projectId, definitionVersion },
          },
        ],
      },
    ],
  });
}

async function historicalFixture(versionCount = 502) {
  const f = await programFixture();
  await f.client.projects.programSave({
    id: f.projectId,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  await f.client.projects.programPublish({
    id: f.projectId,
    expectedRowVersion: 1,
    confirmed: true,
  });
  await f.client.projects.memberMutate({
    id: f.projectId,
    contactId: f.contactId,
    statusId: "attended",
    idempotencyKey: crypto.randomUUID(),
  });
  // Two statuses per later version push all four v1 choices beyond the picker limit.
  await env.DB.prepare(
    `WITH RECURSIVE versions(version) AS (
      SELECT 2 UNION ALL SELECT version + 1 FROM versions WHERE version < ?
    ) INSERT INTO project_program_versions
      (workspace_id, project_id, version, definition, published_at)
      SELECT ?, ?, version, ?, ? FROM versions`,
  )
    .bind(
      versionCount,
      f.workspaceId,
      f.projectId,
      JSON.stringify(PROJECT_PROGRAM_TEMPLATES.resource_request),
      new Date().toISOString(),
    )
    .run();
  return { ...f, role: "owner" as const, filter: statusFilter(f.projectId) };
}

function automationDefinition(filter: SegmentFilter): AutomationDefinition {
  return {
    name: "Historical program audience",
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: {
          source: "batch",
          reentry: "every_time",
          audience: { kind: "filter", filter },
          schedule: { kind: "now" },
        },
      },
      {
        id: "condition",
        type: "condition",
        position: { x: 0, y: 100 },
        config: { filter },
      },
    ],
    edges: [{ id: "next", source: "source", target: "condition", branch: "next" }],
  };
}

it.each([502, 1002])(
  "saves and previews a historical segment beyond the catalog cap with %i program versions",
  async (versionCount) => {
    const f = await historicalFixture(versionCount);
    const catalog = await f.client.segments.options();
    expect(catalog.projectStatuses).toHaveLength(1000);
    expect(
      catalog.projectStatuses?.some((option) => option.programStatus?.definitionVersion === 1),
    ).toBe(false);
    expect(await f.client.segments.validate({ filter: f.filter })).toMatchObject({ valid: true });
    for (const operator of ["eq", "neq"] as const) {
      expect(
        await f.client.segments.validate({
          filter: statusFilter(f.projectId, 1, "attended", operator),
        }),
      ).toMatchObject({ valid: true });
    }
    // Generation/refinement supplies the bounded catalog it already loaded.
    expect(await validateSegmentFilter(createDatabase(env.DB), f, f.filter, catalog)).toMatchObject(
      {
        valid: true,
      },
    );
    const segment = await f.client.segments.create({
      name: "Historical attendees",
      kind: "dynamic",
      filter: f.filter,
      membershipSource: null,
    });
    await f.client.segments.update({
      id: segment.id,
      name: segment.name,
      slug: segment.slug,
      kind: "dynamic",
      filter: f.filter,
      membershipSource: null,
    });
    const preview = await f.client.segments.preview({ filter: f.filter });
    expect(preview.contacts.map((contact) => contact.id)).toEqual([f.contactId]);
    expect((await f.client.segments.options()).projectStatuses).toHaveLength(1000);
  },
);

it("validates historical automation conditions and batch audiences through publication and run preview", async () => {
  const f = await historicalFixture();
  const definition = automationDefinition(f.filter);
  const context = await loadAutomationResourceContext(createDatabase(env.DB), f);
  expect(await validateAutomationResources(definition, context)).toEqual([]);
  const automation = await f.client.automations.create(definition);
  await f.client.automations.saveDraft({ ...definition, id: automation.id });
  expect((await f.client.automations.getDraft({ id: automation.id })).publishability).toMatchObject(
    {
      publishable: true,
    },
  );
  await f.client.automations.publish({ id: automation.id });
  expect(await f.client.automations.previewRun({ id: automation.id })).toMatchObject({
    count: 1,
    sample: [{ id: f.contactId }],
  });
});

it("rejects nonexistent, cross-project, cross-version and foreign-workspace status tuples", async () => {
  const f = await historicalFixture();
  const otherProject = await f.client.projects.create({ name: "Other project" });
  await f.client.projects.programSave({
    id: otherProject.id,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.resource_request,
  });
  await f.client.projects.programPublish({
    id: otherProject.id,
    expectedRowVersion: 1,
    confirmed: true,
  });
  const foreign = await historicalFixture();
  const context = await loadAutomationResourceContext(createDatabase(env.DB), f);
  const foreignCatalog = await foreign.client.segments.options();
  const filters = [
    statusFilter(f.projectId, 1, "missing"),
    statusFilter(f.projectId, 1, ["attended", "missing"]),
    statusFilter(f.projectId, 503, "attended"),
    statusFilter("missing-project", 1, "attended"),
    statusFilter(otherProject.id, 1, "attended"),
    statusFilter(f.projectId, 2, "attended"),
    statusFilter(f.projectId, 1, "requested"),
    statusFilter(foreign.projectId, 1, "attended"),
    statusFilter(foreign.projectId, 502, "requested"),
  ];
  for (const filter of filters) {
    expect(await f.client.segments.validate({ filter })).toMatchObject({
      valid: false,
      issues: [
        { phase: "resource", code: "resource_not_found", path: "$.children[0].children[0]" },
      ],
    });
    expect(await validateAutomationResources(automationDefinition(filter), context)).toMatchObject([
      { kind: "filter", nodeId: "source", path: "$.children[0].children[0]" },
      { kind: "filter", nodeId: "condition", path: "$.children[0].children[0]" },
    ]);
  }
  expect(
    await validateSegmentFilter(
      createDatabase(env.DB),
      f,
      statusFilter(foreign.projectId, 502, "requested"),
      foreignCatalog,
    ),
  ).toMatchObject({ valid: false, issues: [{ phase: "resource" }] });
  const invalidFilter = statusFilter(f.projectId, 1, ["attended", "missing"]);
  await expect(
    f.client.segments.create({ name: "Invalid tuple", kind: "dynamic", filter: invalidFilter }),
  ).rejects.toMatchObject({ code: "INVALID_SEGMENT_FILTER" });
  const automation = await f.client.automations.create(automationDefinition(invalidFilter));
  expect((await f.client.automations.getDraft({ id: automation.id })).publishability).toMatchObject(
    {
      publishable: false,
    },
  );
  await expect(f.client.automations.publish({ id: automation.id })).rejects.toMatchObject({
    code: "INVALID_GRAPH",
  });
});

it("resolves many referenced versions without dropping a later invalid tuple", async () => {
  const f = await historicalFixture();
  const filter: SegmentFilter = {
    kind: "group",
    combinator: "or",
    children: Array.from({ length: 3 }, (_, group) => ({
      kind: "group",
      combinator: "or",
      children: Array.from({ length: 20 }, (_, index) =>
        statusFilter(f.projectId, 2 + group * 20 + index, "requested"),
      ),
    })),
  };
  expect(await f.client.segments.validate({ filter })).toMatchObject({ valid: true });
  filter.children.push(statusFilter(f.projectId, 1, "requested"));
  expect(await f.client.segments.validate({ filter })).toMatchObject({
    valid: false,
    issues: [{ phase: "resource", path: "$.children[3].children[0].children[0]" }],
  });
});

it("rejects malformed program references and qualifiers on unsupported conditions", async () => {
  const f = await programFixture();
  for (const condition of [
    { program: { projectId: f.projectId, definitionVersion: 0 } },
    { program: { projectId: f.projectId, definitionVersion: "1" } },
    { program: { projectId: "", definitionVersion: 1 } },
    { program: { projectId: f.projectId } },
    { value: 123 },
    { value: null, operator: "exists" },
    { field: "project_id" },
  ]) {
    const result = await f.client.segments.validate({
      filter: {
        kind: "group",
        relation: "project_member",
        combinator: "and",
        children: [
          {
            kind: "condition",
            field: "project_status",
            operator: "eq",
            value: "attended",
            program: { projectId: f.projectId, definitionVersion: 1 },
            ...condition,
          },
        ],
      },
    });
    expect(result).toMatchObject({ valid: false, issues: [{ phase: "schema" }] });
  }
});
