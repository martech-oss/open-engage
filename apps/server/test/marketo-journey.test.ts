import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

import type { AutomationDefinition } from "@openengage/core/automations";
import type { ProjectClonePreview, ProjectProgramDefinition } from "@openengage/core/projects";
import {
  AutomationCallRepository,
  AutomationJobRepository,
  AutomationRunRepository,
} from "@openengage/database/automations";
import { createDatabase } from "@openengage/database/client";
import { ProjectCloneJobRepository } from "@openengage/database/projects";
import { nowIso } from "@openengage/database/testing";
import { PublicFormRepository } from "@openengage/database/web";

import {
  dispatchScheduledAutomationRuns,
  processAutomationRun,
} from "../src/automations/run-service";
import { processAutomationJob } from "../src/automations/worker";
import { createAutomationExecutionDependencies } from "../src/runtime/automation-execution";
import { queueStub, runtimeWithJobsQueue } from "./automation-recovery-test-support";
import { createSessionFixtureClient, seedMember, seedWorkspaceClient } from "./factory";
import { addProjectBriefMember, projectBriefInput } from "./project-brief-test-support";

function clonedResource(preview: ProjectClonePreview, kind: string, sourceId: string) {
  const resource = preview.resources.find(
    (item) => item.kind === kind && item.sourceId === sourceId,
  );
  if (!resource) throw new Error(`Clone manifest is missing ${kind} ${sourceId}`);
  return resource;
}

async function finishClone(repository: ProjectCloneJobRepository, jobId: string) {
  for (let chunk = 0; chunk < 30; chunk++) {
    if ((await repository.process(jobId, 3)) === "completed") return;
  }
  throw new Error("Clone did not finalize within its bounded manifest");
}

// This full journey makes many real D1 calls; allow for shared CI runner latency.
it("runs a cloned campaign from acquisition to success", { timeout: 30_000 }, async () => {
  const fixture = await seedWorkspaceClient(env.DB);
  await seedMember(env.DB, fixture);
  const owner = {
    workspaceId: fixture.workspaceId,
    userId: fixture.userId,
    role: "owner" as const,
  };
  const approver = await addProjectBriefMember(owner, "journey-approver", "marketer");
  const { client: reviewer } = await createSessionFixtureClient(env.DB, approver);
  const { client, workspaceId, slug } = fixture;
  const database = createDatabase(env.DB);
  const source = await client.projects.briefCreate({
    ...projectBriefInput(owner.userId, approver.userId),
    name: "秋の問い合わせ施策",
  });
  const definition: ProjectProgramDefinition = {
    kind: "inquiry",
    initialStatusId: "received",
    statuses: [
      { id: "received", label: "問い合わせ受付", success: false, nextStatusIds: ["reviewing"] },
      { id: "reviewing", label: "営業確認待ち", success: false, nextStatusIds: ["qualified"] },
      { id: "qualified", label: "商談化", success: true, nextStatusIds: [] },
    ],
  };
  await client.projects.programSave({ id: source.id, expectedRowVersion: 0, definition });
  await client.projects.briefSubmit({ id: source.id });
  await reviewer.projects.briefApprove({ id: source.id, comment: "目的・対象・引継ぎ条件を確認" });
  await client.projects.programPublish({ id: source.id, expectedRowVersion: 1, confirmed: true });
  await client.projects.variablesSave({
    projectId: source.id,
    key: "handoff_title",
    type: "string",
    value: "秋の問い合わせ営業確認",
    expectedRevision: 0,
  });
  const formInput = {
    name: "問い合わせ登録",
    slug: "journey-source-inquiry",
    variableProjectId: source.id,
    status: "draft" as const,
    turnstileEnabled: false,
    allowedDomains: [],
    definition: { fields: [{ key: "email", type: "email" as const, label: "メールアドレス" }] },
    successMessage: "受付完了: {{variables.handoff_title}}",
  };
  const form = await client.website.createForm(formInput);
  await client.projects.briefAddItem({ id: source.id, resourceType: "form", resourceId: form.id });
  await client.projects.programBindForm({
    id: source.id,
    formId: form.id,
    binding: { projectId: source.id, definitionVersion: 1, statusId: "received" },
    confirmed: true,
  });
  await client.website.updateForm({ ...formInput, id: form.id, status: "published" });
  const brief = await client.projects.briefGet({ id: source.id });
  const child = await client.automations.create({
    name: "営業引継ぎ",
    projectId: source.id,
    briefRevision: brief.project.revision,
    variableProjectId: source.id,
    nodes: [
      { id: "source", type: "source", position: { x: 0, y: 0 }, config: { source: "callable" } },
      {
        id: "handoff",
        type: "action",
        position: { x: 1, y: 0 },
        config: {
          action: "handoff_to_sales",
          ownerUserId: owner.userId,
          title: { kind: "variable", key: "handoff_title", type: "string" },
        },
      },
    ],
    edges: [{ id: "handoff-edge", source: "source", target: "handoff", branch: "next" }],
  });
  await client.automations.publish({ id: child.id });
  // The source is next week's campaign; the clone will get its own upcoming slot.
  const sourceSlot = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const parent = await client.automations.create({
    name: "問い合わせ営業確認バッチ",
    projectId: source.id,
    briefRevision: brief.project.revision,
    variableProjectId: source.id,
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: {
          source: "batch",
          reentry: "once",
          schedule: { kind: "once", at: sourceSlot },
          audience: {
            kind: "filter",
            filter: {
              kind: "group",
              relation: "project_member",
              combinator: "and",
              children: [
                { kind: "condition", field: "project_id", operator: "eq", value: source.id },
                { kind: "condition", field: "project_status", operator: "eq", value: "reviewing" },
              ],
            },
          },
        },
      },
      {
        id: "call",
        type: "action",
        position: { x: 1, y: 0 },
        config: { action: "call_automation", automationId: child.id, mode: "await" },
      },
      {
        id: "success",
        type: "action",
        position: { x: 2, y: 0 },
        config: { action: "upsert_project_member", projectId: source.id, statusId: "qualified" },
      },
    ],
    edges: [
      { id: "call-edge", source: "source", target: "call", branch: "next" },
      { id: "success-edge", source: "call", target: "success", branch: "next" },
    ],
  });
  await client.automations.publish({ id: parent.id });
  const sourceSnapshot = {
    program: await client.projects.programGet({ id: source.id }),
    variables: await client.projects.variablesList({ projectId: source.id }),
    child: await client.automations.getDraft({ id: child.id }),
    parent: await client.automations.getDraft({ id: parent.id }),
    form: (await client.website.listForms()).find((item) => item.id === form.id),
  };

  const preview = await client.projects.clonePreview({
    id: source.id,
    options: {
      name: "冬の問い合わせ施策",
      ownerUserId: owner.userId,
      approverUserId: approver.userId,
      reviewAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      variables: {},
    },
  });
  await client.projects.cloneStart({
    id: source.id,
    jobId: preview.id,
    requestKey: "journey-clone",
  });
  await finishClone(new ProjectCloneJobRepository(database, owner), preview.id);
  expect((await client.projects.cloneGet({ id: source.id, jobId: preview.id })).status).toBe(
    "completed",
  );
  const targetId = preview.targetProjectId;
  const targetForm = clonedResource(preview, "form", form.id);
  const targetChild = clonedResource(preview, "automation", child.id);
  const targetParent = clonedResource(preview, "automation", parent.id);
  const draftProgram = await client.projects.programGet({ id: targetId });
  expect(draftProgram.brief?.project.status).toBe("draft");
  expect(draftProgram.program?.publishedVersion).toBeNull();
  expect(draftProgram.formBindings).toMatchObject([
    {
      projectId: targetId,
      formId: targetForm.targetId,
      definitionVersion: null,
      statusId: "received",
    },
  ]);
  expect((await client.projects.memberList({ id: targetId })).total).toBe(0);
  const targetFormUrl = `http://localhost:8787/f/${slug}/${targetForm.targetSlug}`;
  expect((await exports.default.fetch(new Request(targetFormUrl))).status).toBe(404);
  await client.projects.variablesSave({
    projectId: targetId,
    key: "handoff_title",
    type: "string",
    value: "冬の問い合わせ営業確認",
    expectedRevision: 1,
  });
  await client.projects.briefSubmit({ id: targetId });
  await reviewer.projects.briefApprove({ id: targetId, comment: "複製施策の変数と対象を再確認" });
  expect((await client.projects.briefGet({ id: targetId })).reviews).toHaveLength(1);
  await client.projects.programPublish({
    id: targetId,
    expectedRowVersion: draftProgram.program!.rowVersion,
    confirmed: true,
  });
  const draftForm = (await client.website.listForms()).find(
    (item) => item.id === targetForm.targetId,
  )!;
  expect(draftForm.variableProjectId).toBe(targetId);
  await client.website.updateForm({ ...draftForm, status: "published" });
  const publishedForm = await new PublicFormRepository(database).findPublishedForm(
    slug,
    targetForm.targetSlug!,
  );
  expect(publishedForm?.successMessage).toBe("受付完了: 冬の問い合わせ営業確認");
  const clonedParent = await client.automations.getDraft({ id: targetParent.targetId });
  expect(clonedParent.graph.variableProjectId).toBe(targetId);
  expect(clonedParent.graph.nodes.find((node) => node.id === "call")?.config).toMatchObject({
    automationId: targetChild.targetId,
  });
  expect(clonedParent.graph.nodes.find((node) => node.id === "success")?.config).toMatchObject({
    projectId: targetId,
  });
  const slot = new Date(Date.now() + 60_000).toISOString();
  const cloneGraph: AutomationDefinition = {
    ...clonedParent.graph,
    nodes: clonedParent.graph.nodes.map((node) =>
      node.type === "source" && node.config.source === "batch"
        ? { ...node, config: { ...node.config, schedule: { kind: "once", at: slot } } }
        : node,
    ),
  };
  await client.automations.saveDraft({ id: targetParent.targetId, ...cloneGraph });
  await client.automations.publish({ id: targetChild.targetId });
  await client.automations.publish({ id: targetParent.targetId });

  const cohortFrom = nowIso();
  const request = () =>
    new Request(targetFormUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "journey-contact-submission",
      },
      body: JSON.stringify({ email: "winter-inquiry@example.com" }),
    });
  const submitted = await exports.default.fetch(request());
  expect(submitted.status).toBe(202);
  expect(await submitted.json()).toMatchObject({
    data: { accepted: true, message: "受付完了: 冬の問い合わせ営業確認" },
  });
  expect(await (await exports.default.fetch(request())).json()).toMatchObject({
    data: { duplicate: true },
  });
  const members = await client.projects.memberList({ id: targetId });
  expect(members.total).toBe(1);
  const member = members.items[0]!.member;
  expect(member).toMatchObject({
    statusId: "received",
    source: "form",
    definitionVersion: 1,
    firstSuccessAt: null,
  });
  expect(await client.contacts.get({ id: member.contactId })).toMatchObject({
    acquisitionProjectId: targetId,
  });
  await client.projects.memberMutate({
    id: targetId,
    contactId: member.contactId,
    statusId: "reviewing",
    source: "manual",
    expectedRevision: member.revision,
    idempotencyKey: "journey-reviewed-contact",
  });
  const beforeSuccess = nowIso();
  const queue = queueStub();
  await dispatchScheduledAutomationRuns(database, new Date(slot), 100, queue);
  const runs = await client.automations.listRuns({ id: targetParent.targetId });
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ slot, targetCount: 1 });
  const runId = runs[0]!.id;
  await processAutomationRun(runId, workspaceId, database, 100, queue);
  const engine = new AutomationJobRepository(database);
  const calls = new AutomationCallRepository(database);
  const runtime = runtimeWithJobsQueue(queue);
  for (let round = 0; round < 12; round++) {
    await calls.recover(nowIso());
    for (const job of await engine.claimDueJobs(
      nowIso(),
      new Date(Date.now() + 60_000).toISOString(),
    ))
      await processAutomationJob(
        job.id,
        job.leaseId,
        createAutomationExecutionDependencies(runtime),
      );
  }
  await new AutomationRunRepository(database, owner).refresh(runId);
  const completedRun = await client.automations.runDetail({ id: targetParent.targetId, runId });
  expect(completedRun.run).toMatchObject({
    status: "completed",
    targetCount: 1,
    enrolledCount: 1,
    flowCompletedCount: 1,
    flowFailedCount: 0,
  });
  const enrollment = await client.automations.enrollmentDetail({
    id: targetParent.targetId,
    enrollmentId: completedRun.targets[0]!.enrollmentId!,
  });
  expect(enrollment).toMatchObject({ projectId: targetId, status: "completed" });
  expect(enrollment.children).toMatchObject([
    { automationId: targetChild.targetId, status: "completed" },
  ]);
  expect(
    await client.automations.enrollmentDetail({
      id: targetChild.targetId,
      enrollmentId: enrollment.children[0]!.id,
    }),
  ).toMatchObject({ projectId: targetId, status: "completed" });
  const tasks = await client.deals.contactTasks({ contactId: member.contactId });
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ title: "冬の問い合わせ営業確認", assignedUserId: owner.userId });
  expect((await client.projects.memberList({ id: targetId })).items[0]?.member).toMatchObject({
    statusId: "qualified",
    firstSuccessAt: expect.any(String),
  });
  expect(
    await client.projects.memberHistory({ id: targetId, contactId: member.contactId }),
  ).toHaveLength(3);
  const cohort = {
    id: targetId,
    from: cohortFrom,
    to: new Date(Date.now() + 86_400_000).toISOString(),
  };
  expect(await client.projects.programCohort({ ...cohort, asOf: beforeSuccess })).toMatchObject({
    members: 1,
    succeeded: 0,
    rate: 0,
  });
  const report = await client.projects.programCohort({ ...cohort, asOf: nowIso() });
  expect(report).toMatchObject({
    members: 1,
    succeeded: 1,
    rate: 1,
    averageTimeToSuccessSeconds: expect.any(Number),
  });
  expect(report.averageTimeToSuccessSeconds).toBeGreaterThanOrEqual(0);
  await dispatchScheduledAutomationRuns(database, new Date(slot), 100, queue);
  expect(await calls.recover(nowIso())).toBe(0);
  expect(await client.automations.listRuns({ id: targetParent.targetId })).toHaveLength(1);
  expect(await client.deals.contactTasks({ contactId: member.contactId })).toHaveLength(1);

  const unchangedSource = await client.projects.programGet({ id: source.id });
  const cloneAudit = unchangedSource.brief!.audit.filter(
    (item) => item.action === "project.clone.start",
  );
  expect(cloneAudit).toHaveLength(1);
  expect({
    ...unchangedSource,
    brief: {
      ...unchangedSource.brief,
      audit: unchangedSource.brief!.audit.filter((item) => item.action !== "project.clone.start"),
    },
  }).toEqual(sourceSnapshot.program);
  expect(await client.projects.variablesList({ projectId: source.id })).toEqual(
    sourceSnapshot.variables,
  );
  expect(await client.automations.getDraft({ id: child.id })).toEqual(sourceSnapshot.child);
  expect(await client.automations.getDraft({ id: parent.id })).toEqual(sourceSnapshot.parent);
  expect((await client.website.listForms()).find((item) => item.id === form.id)).toEqual(
    sourceSnapshot.form,
  );
  expect((await client.projects.memberList({ id: source.id })).total).toBe(0);
  expect(await client.automations.listRuns({ id: parent.id })).toHaveLength(0);
});
