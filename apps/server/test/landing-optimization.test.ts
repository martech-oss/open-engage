import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";
import { createDatabase } from "@openengage/database/client";
import { VisitorRepository } from "@openengage/database/contacts";
import { OptimizationRepository } from "@openengage/database/web";

import { toReportRange } from "../src/reports/shared";
import { recordContactEvent } from "../src/runtime/contact-event-service";
import { selectLandingOptimization } from "../src/web/optimization-service";
import { seedWorkspaceClient } from "./factory";

it("pins assignments and counts actual visitor exposure and a single conversion within 30 days", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const page = await client.website.createPage({
    name: "Test",
    slug: "test",
    status: "draft",
    document: emptyLandingPageDocument(),
  });
  await client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  const next = await client.website.updatePage({
    id: page.id,
    name: "Test",
    slug: "test",
    status: "draft",
    baseVersionId: page.versionId,
    document: emptyLandingPageDocument("B"),
  });
  await client.website.publishPage({
    id: page.id,
    versionId: next.versionId,
    baseVersionId: next.versionId,
  });
  const id = crypto.randomUUID();
  await client.website.createExperiment({
    id,
    pageId: page.id,
    name: "Comparison",
    variants: [
      { id: "a", name: "A", pageVersionId: page.versionId, weight: 50 },
      { id: "b", name: "B", pageVersionId: next.versionId, weight: 50 },
    ],
  });
  await client.website.startExperiment({ id });
  await env.DB.prepare(
    "UPDATE landing_experiments SET started_at='2026-01-01T00:00:00.000Z' WHERE id=?",
  )
    .bind(id)
    .run();
  const db = createDatabase(env.DB),
    visitorId = crypto.randomUUID();
  await new VisitorRepository(db).create(workspaceId, visitorId);
  const selection = await selectLandingOptimization(db, {
    workspaceId,
    pageId: page.id,
    defaultVersionId: page.versionId,
    visitorId,
    contactId: null,
  });
  expect(
    await selectLandingOptimization(db, {
      workspaceId,
      pageId: page.id,
      defaultVersionId: page.versionId,
      visitorId,
      contactId: null,
    }),
  ).toEqual(selection);
  const repo = new OptimizationRepository(db, { workspaceId });
  const identity = {
    visitorId,
    exposureId: selection.exposureId!,
    pageVersionId: selection.pageVersionId,
  };
  const range = toReportRange("2026-01-01", "2026-01-31");
  expect(await repo.report(id, range, "2026-02-01T00:00:00.000Z")).toEqual([]);
  await repo.expose(identity, "2026-01-02T00:00:00.000Z");
  await repo.expose(identity, "2026-01-01T00:00:00.000Z");
  await repo.convert(identity, "2026-01-31T00:00:00.001Z");
  expect((await repo.report(id, range, "2026-02-01T00:00:00.000Z"))[0]?.conversions).toBe(0);
  await repo.convert(identity, "2026-01-31T00:00:00.000Z");
  await repo.convert(identity, "2026-01-31T00:00:00.000Z");
  expect((await repo.report(id, range, "2026-02-01T00:00:00.000Z"))[0]).toMatchObject({
    day: "2026-01-01",
    visitors: 1,
    conversions: 1,
    pendingVisitors: 0,
  });
  const before = await repo.report(id, range, "2026-01-20T00:00:00.000Z");
  expect(before[0]?.pendingVisitors).toBe(1);
  const secondVisitor = crypto.randomUUID();
  await new VisitorRepository(db).create(workspaceId, secondVisitor);
  const second = await selectLandingOptimization(db, {
    workspaceId,
    pageId: page.id,
    defaultVersionId: page.versionId,
    visitorId: secondVisitor,
    contactId: null,
  });
  const properties = { exposureId: second.exposureId, pageVersionId: second.pageVersionId };
  await recordContactEvent(db, {
    workspaceId,
    visitorId: secondVisitor,
    contactId: null,
    type: "form_submitted",
    properties,
    occurredAt: "2026-01-02T00:00:00.000Z",
  });
  const lateVisitor = crypto.randomUUID();
  await new VisitorRepository(db).create(workspaceId, lateVisitor);
  const late = await selectLandingOptimization(db, {
    workspaceId,
    pageId: page.id,
    defaultVersionId: page.versionId,
    visitorId: lateVisitor,
    contactId: null,
  });
  await client.website.endExperiment({
    id,
    winnerVariantId: null,
    expectedPublishedVersionId: next.versionId,
  });
  await recordContactEvent(db, {
    workspaceId,
    visitorId: secondVisitor,
    contactId: null,
    type: "page_viewed",
    properties,
    occurredAt: "2026-01-01T00:00:00.000Z",
  });
  await recordContactEvent(db, {
    workspaceId,
    visitorId: secondVisitor,
    contactId: null,
    type: "page_viewed",
    properties,
    occurredAt: "2026-01-01T01:00:00.000Z",
  });
  const ended = await repo.experiment(id);
  await recordContactEvent(db, {
    workspaceId,
    visitorId: lateVisitor,
    contactId: null,
    type: "page_viewed",
    properties: { exposureId: late.exposureId, pageVersionId: late.pageVersionId },
    occurredAt: new Date(Date.parse(ended!.endedAt!) + 1000).toISOString(),
  });
  expect((await repo.assignment(id, lateVisitor))?.exposedAt).toBeNull();
  const combined = await repo.report(id, range, "2026-02-01T00:00:00.000Z");
  expect(combined.reduce((sum, row) => sum + row.visitors, 0)).toBe(2);
  expect(combined.reduce((sum, row) => sum + row.conversions, 0)).toBe(2);
});
