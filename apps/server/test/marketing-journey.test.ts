import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";
import { AutomationJobRepository } from "@openengage/database/automations";
import { createDatabase } from "@openengage/database/client";

import { processAutomationJob } from "../src/automations/worker";
import type { RuntimeEnv } from "../src/env";
import { createAutomationExecutionDependencies } from "../src/runtime/automation-execution";
import { retryPendingPublicFormEvents } from "../src/runtime/contact-event-service";
import { processVisitorHistory } from "../src/runtime/visitor-history-worker";
import { reconcileContactSegmentMemberships } from "../src/segments/membership-service";
import { verifyMeasurementContext } from "../src/web/measurement-service";
import { seedMember, seedWorkspaceClient } from "./factory";

async function post(path: string, body: unknown) {
  return exports.default.fetch(
    new Request(`http://localhost:8787${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify(body),
    }),
  );
}

it("connects anonymous LP -> form -> score segment -> handoff -> won deal -> ROI and lifecycle", async () => {
  const fixture = await seedWorkspaceClient(env.DB),
    { client, workspaceId, slug, userId } = fixture;
  await seedMember(env.DB, fixture);
  const database = createDatabase(env.DB),
    queue = { send: async () => {}, sendBatch: async () => {} } as unknown as Queue;
  const runtime = { ...env, JOBS_QUEUE: queue } as unknown as RuntimeEnv;
  const project = await client.projects.create({ name: "LP journey" });
  const today = new Date().toISOString().slice(0, 10);
  await client.projects.createCost({
    id: project.id,
    costId: crypto.randomUUID(),
    bookedOn: today,
    category: "広告",
    amount: 100,
    currency: "JPY",
  });
  for (const eventType of ["page_viewed", "form_submitted"] as const)
    await client.scoring.createRule({
      name: eventType,
      eventType,
      matchType: "any",
      matchValue: null,
      points: 5,
      categoryId: null,
      tagId: null,
      enabled: true,
    });
  const segment = await client.segments.create({
    name: "Ready for sales",
    slug: "ready",
    kind: "dynamic",
    filter: { kind: "condition", field: "score", operator: "gte", value: 10 },
  });
  const automation = await client.automations.create({
    name: "Qualified handoff",
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "segment_joined", segmentId: segment.id, reentry: "once" },
      },
      {
        id: "sales",
        type: "action",
        position: { x: 100, y: 0 },
        config: {
          action: "handoff_to_sales",
          ownerUserId: userId,
          preserveOwner: true,
          title: "Contact this lead",
        },
      },
    ],
    edges: [{ id: "next", source: "source", target: "sales", branch: "next" }],
  });
  await client.automations.publish({ id: automation.id });
  const document = {
    ...emptyLandingPageDocument("Journey"),
    html: '<main><h1>Journey</h1><div data-oe-form="contact"></div></main>',
    forms: [
      {
        refId: "contact",
        name: "Request",
        definition: {
          fields: [
            { key: "email", kind: "standard" as const, type: "email" as const, required: true },
          ],
        },
        successMessage: "Thanks",
        turnstileEnabled: false,
      },
    ],
    measurement: { projectId: project.id, primaryConversion: "form_submitted" as const },
  };
  const page = await client.website.createPage({
    name: "Journey",
    slug: "journey",
    status: "draft",
    document,
  });
  await client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  const baseline = await exports.default.fetch(
    new Request(`http://localhost:8787/p/${slug}/journey`),
  );
  expect(baseline.headers.get("cache-control")).toBe("private, no-store");
  expect(baseline.status).toBe(200);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM site_visitors WHERE workspace_id=?")
      .bind(workspaceId)
      .first(),
  ).toEqual({ n: 0 });
  const resolved = await post(`/api/public/landing/${slug}/journey/resolve`, {
    consent: true,
    source: { url: "https://example.com/journey?utm_source=test" },
  });
  const { data } = (await resolved.json()) as {
    data: { visitorToken: string; measurementToken: string };
  };
  const measurement = await verifyMeasurementContext(database, runtime, data.measurementToken);
  expect(measurement?.visitorId).toEqual(expect.any(String));
  const viewed = await post("/api/public/landing/events", {
    consent: true,
    ...data,
    type: "page_viewed",
  });
  expect(viewed.status).toBe(202);
  const design = await client.website.getPageDesign({ id: page.id });
  const binding = design.versions.find((version) => version.id === page.versionId)!
    .formBindings[0]!;
  const submission = {
    email: "journey@example.com",
    consent: true,
    oe_v: data.visitorToken,
    measurementToken: data.measurementToken,
    idempotencyKey: crypto.randomUUID(),
  };
  const response = await post(`/f/${slug}/lp-${binding.formId}`, submission);
  expect(response.status).toBe(202);
  expect((await post(`/f/${slug}/lp-${binding.formId}`, submission)).status).toBe(202);
  expect(await retryPendingPublicFormEvents(database, queue)).toEqual([]);
  await processVisitorHistory(runtime, workspaceId, measurement!.visitorId!);
  const contact = await env.DB.prepare(
    "SELECT id,score FROM contacts WHERE workspace_id=? AND email=?",
  )
    .bind(workspaceId, submission.email)
    .first<{ id: string; score: number }>();
  expect(contact?.score).toBe(10);
  await reconcileContactSegmentMemberships(database, workspaceId, contact!.id);
  expect(await retryPendingPublicFormEvents(database, queue)).toEqual([]);
  for (let turn = 0; turn < 4; turn++) {
    const jobs = await new AutomationJobRepository(database).claimDueJobs(
      new Date().toISOString(),
      "2099-01-01T00:00:00.000Z",
      20,
      workspaceId,
    );
    for (const job of jobs) {
      await processAutomationJob(
        job.id,
        job.leaseId,
        createAutomationExecutionDependencies(runtime),
      );
      await processAutomationJob(
        job.id,
        job.leaseId,
        createAutomationExecutionDependencies(runtime),
      );
    }
  }
  expect(await client.deals.contactTasks({ contactId: contact!.id })).toHaveLength(1);
  expect(
    await env.DB.prepare("SELECT lifecycle_stage,owner_user_id FROM contacts WHERE id=?")
      .bind(contact!.id)
      .first(),
  ).toEqual({ lifecycle_stage: "mql", owner_user_id: userId });
  const { pipelines } = await client.deals.options(),
    pipeline = pipelines[0]!;
  const deal = await client.deals.create({
    name: "Journey deal",
    pipelineId: pipeline.id,
    stageId: pipeline.stages[0]!.id,
    contactId: contact!.id,
    currency: "JPY",
    value: 500,
  });
  await client.deals.update({ id: deal.id, status: "won" });
  const roi = await client.reports.campaigns({ from: today, to: today, currency: "JPY" });
  expect(roi.campaigns.find((row) => row.id === project.id)).toMatchObject({
    cost: 100,
    attributedValue: 500,
    roi: 400,
  });
  const acquisition = await client.reports.acquisition({ from: today, to: today, currency: "JPY" });
  expect(acquisition.sources.find((row) => row.source === "test")).toMatchObject({
    visitors: 1,
    submissions: 1,
    submittingContacts: 1,
    mql: 1,
    dealsCreated: 1,
    won: 1,
    wonValue: 500,
  });
  const progress = await client.reports.lifecycle({
    from: today,
    to: today,
    projectId: project.id,
    ownerUserId: userId,
  });
  expect(progress.summary).toMatchObject({
    leads: 1,
    mql: 1,
    sql: 1,
    customer: 1,
    skippedMql: 0,
    skippedSql: 0,
  });
});
