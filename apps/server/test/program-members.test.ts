import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { createDatabase } from "@openengage/database/client";

import * as service from "../src/projects/service";
import { programFixture as fixture } from "./program-test-support";

describe("program membership persistence and API", () => {
  it("enrolls once across retries, pins definition meaning, and corrects outcomes as of a timestamp", async () => {
    expect(service.mutateProjectMember).toBeTypeOf("function");
    const f = await fixture();
    const definition = PROJECT_PROGRAM_TEMPLATES.event;
    await f.client.projects.programSave({ id: f.projectId, expectedRowVersion: 0, definition });
    await f.client.projects.programPublish({
      id: f.projectId,
      expectedRowVersion: 1,
      confirmed: true,
    });
    const command = {
      projectId: f.projectId,
      contactId: f.contactId,
      statusId: "attended",
      source: "api" as const,
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await service.mutateProjectMember(
      createDatabase(env.DB),
      { workspaceId: f.workspaceId },
      command,
    );
    const duplicate = await service.mutateProjectMember(
      createDatabase(env.DB),
      { workspaceId: f.workspaceId },
      command,
    );
    expect(first.member).toMatchObject({ definitionVersion: 1, statusId: "attended", revision: 1 });
    expect(first.eventIds).toHaveLength(2);
    expect(duplicate).toEqual({ ...first, duplicate: true });
    await expect(
      service.mutateProjectMember(
        createDatabase(env.DB),
        { workspaceId: f.workspaceId },
        { ...command, statusId: "absent" },
      ),
    ).rejects.toThrow(/idempotency/i);
    const asOf = first.member.updatedAt;
    await f.client.projects.programSave({
      id: f.projectId,
      expectedRowVersion: 2,
      definition: {
        ...definition,
        statuses: definition.statuses.map((s) =>
          s.id === "attended"
            ? { ...s, label: "Different", success: false }
            : s.id === "absent"
              ? { ...s, success: true }
              : s,
        ),
      },
    });
    await f.client.projects.programPublish({
      id: f.projectId,
      expectedRowVersion: 3,
      confirmed: true,
    });
    const corrected = await f.client.projects.memberMutate({
      id: f.projectId,
      contactId: f.contactId,
      statusId: "absent",
      source: "manual",
      mode: "correction",
      reason: "Incorrect badge scan",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(corrected.member).toMatchObject({
      definitionVersion: 1,
      statusLabel: "欠席",
      firstSuccessAt: null,
      revision: 2,
    });
    const cohort = {
      id: f.projectId,
      from: "2000-01-01T00:00:00.000Z",
      to: "2100-01-01T00:00:00.000Z",
    };
    expect(await f.client.projects.programCohort({ ...cohort, asOf })).toMatchObject({
      members: 1,
      succeeded: 1,
      rate: 1,
    });
    expect(
      await f.client.projects.programCohort({ ...cohort, asOf: new Date().toISOString() }),
    ).toMatchObject({ members: 1, succeeded: 0, rate: 0, averageTimeToSuccessSeconds: null });
    expect(
      await f.client.projects.memberHistory({ id: f.projectId, contactId: f.contactId }),
    ).toHaveLength(2);
  });
  it("returns rowwise CSV errors for unknown contacts and scopes every read and write to a workspace", async () => {
    expect(service.mutateProjectMember).toBeTypeOf("function");
    const f = await fixture();
    const other = await fixture();
    await f.client.projects.programSave({
      id: f.projectId,
      expectedRowVersion: 0,
      definition: PROJECT_PROGRAM_TEMPLATES.inquiry,
    });
    await f.client.projects.programPublish({
      id: f.projectId,
      expectedRowVersion: 1,
      confirmed: true,
    });
    const imported = await f.client.projects.memberImport({
      id: f.projectId,
      csv: `contactId,statusId\n${f.contactId},qualified\n${f.contactId},bad status!\nunknown,received\n${other.contactId},received`,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(imported.rows.map((r) => r.ok)).toEqual([true, false, false, false]);
    await expect(
      f.client.projects.memberImport({
        id: f.projectId,
        csv: "unsupported\nvalue",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PROGRAM_INVALID" });
    await expect(other.client.projects.programGet({ id: f.projectId })).rejects.toThrow();
    await expect(
      other.client.projects.memberHistory({ id: f.projectId, contactId: f.contactId }),
    ).rejects.toThrow();
    await expect(
      other.client.projects.memberMutate({
        id: f.projectId,
        contactId: other.contactId,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });
});

// Explicit bindings, rather than links or old touches, own acquisition and membership.
describe("program forms", () => {
  it("registers once on form retries and records acquisition only for a newly created contact", async () => {
    const f = await fixture();
    const { FormProgramRepository } = await import("@openengage/database/projects");
    expect(FormProgramRepository).toBeTypeOf("function");
    await f.client.projects.programSave({
      id: f.projectId,
      expectedRowVersion: 0,
      definition: PROJECT_PROGRAM_TEMPLATES.inquiry,
    });
    await f.client.projects.programPublish({
      id: f.projectId,
      expectedRowVersion: 1,
      confirmed: true,
    });
    const form = {
      id: crypto.randomUUID(),
      workspaceId: f.workspaceId,
      name: "Inquiry",
      definition: {},
      allowedDomains: [],
      turnstileEnabled: false,
      successMessage: "Thanks",
    };
    await env.DB.prepare(
      "INSERT INTO forms (id,workspace_id,name,slug,status,definition,allowed_domains,turnstile_enabled,success_message,created_at,updated_at) VALUES (?,?,?,'program-inquiry','published','{}','[]',0,'Thanks',?,?)",
    )
      .bind(form.id, f.workspaceId, form.name, new Date().toISOString(), new Date().toISOString())
      .run();
    await f.client.projects.programBindForm({
      id: f.projectId,
      formId: form.id,
      binding: { projectId: f.projectId, definitionVersion: 1, statusId: "received" },
      confirmed: true,
    });
    const { SubmitPublicFormUseCase } = await import("../src/public/submit-form-use-case");
    const submit = new SubmitPublicFormUseCase(createDatabase(env.DB), env);
    const command = {
      resolvedForm: form,
      workspaceSlug: f.slug,
      formSlug: "program-inquiry",
      body: { email: "new-program@example.com" },
      origin: undefined,
      requestHostname: "localhost",
      connectingIp: undefined,
      idempotencyKeyHeader: crypto.randomUUID(),
    };
    const first = await submit.execute(command);
    expect(first.kind).toBe("accepted");
    const retry = await submit.execute(command);
    expect(retry.kind).toBe("duplicate");
    const created = await env.DB.prepare(
      "SELECT id,acquisition_project_id FROM contacts WHERE workspace_id=? AND email=?",
    )
      .bind(f.workspaceId, "new-program@example.com")
      .first<{ id: string; acquisition_project_id: string }>();
    expect(created?.acquisition_project_id).toBe(f.projectId);
    expect(
      await f.client.projects.memberHistory({ id: f.projectId, contactId: created!.id }),
    ).toHaveLength(1);
    const existing = await env.DB.prepare("SELECT email FROM contacts WHERE id=?")
      .bind(f.contactId)
      .first<{ email: string }>();
    await submit.execute({
      ...command,
      body: { email: existing!.email },
      idempotencyKeyHeader: crypto.randomUUID(),
    });
    expect(
      (
        await env.DB.prepare("SELECT acquisition_project_id FROM contacts WHERE id=?")
          .bind(f.contactId)
          .first()
      )?.acquisition_project_id,
    ).toBeNull();
  });
});

it("serializes concurrent enrollments and rejects stale Automation authority without partial events", async () => {
  const f = await fixture();
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
  const input = {
    projectId: f.projectId,
    contactId: f.contactId,
    statusId: "attended",
    source: "api" as const,
    idempotencyKey: crypto.randomUUID(),
  };
  const results = await Promise.all([
    service.mutateProjectMember(createDatabase(env.DB), f, input),
    service.mutateProjectMember(createDatabase(env.DB), f, input),
  ]);
  expect(
    results.map((r) => r.duplicate).sort((left, right) => Number(left) - Number(right)),
  ).toEqual([false, true]);
  expect(
    await f.client.projects.memberHistory({ id: f.projectId, contactId: f.contactId }),
  ).toHaveLength(1);
  await expect(
    service.mutateProjectMember(createDatabase(env.DB), f, {
      ...input,
      idempotencyKey: crypto.randomUUID(),
      source: "automation",
      authority: { jobId: "missing-job", leaseId: "expired", enrollmentId: "missing-enrollment" },
    }),
  ).rejects.toThrow(/authority/);
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS n FROM project_member_commands WHERE workspace_id=?")
        .bind(f.workspaceId)
        .first()
    )?.n,
  ).toBe(1);
});

it("requires all Project member predicates to match one row and reevaluates outcomes after correction", async () => {
  const { compileWorkspaceSegmentFilter } = await import("@openengage/database/segments");
  const { segmentFilterSchema } = await import("@openengage/core/segments");
  const f = await fixture();
  const other = await f.client.projects.create({ name: "Other event" });
  for (const id of [f.projectId, other.id]) {
    await f.client.projects.programSave({
      id,
      expectedRowVersion: 0,
      definition: PROJECT_PROGRAM_TEMPLATES.event,
    });
    await f.client.projects.programPublish({ id, expectedRowVersion: 1, confirmed: true });
  }
  await service.mutateProjectMember(createDatabase(env.DB), f, {
    projectId: f.projectId,
    contactId: f.contactId,
    statusId: "registered",
    source: "manual",
    idempotencyKey: crypto.randomUUID(),
  });
  await service.mutateProjectMember(createDatabase(env.DB), f, {
    projectId: other.id,
    contactId: f.contactId,
    statusId: "attended",
    source: "manual",
    idempotencyKey: crypto.randomUUID(),
  });
  const filter = segmentFilterSchema.parse({
    kind: "group",
    relation: "project_member",
    combinator: "and",
    children: [
      { kind: "condition", field: "project_id", operator: "eq", value: f.projectId },
      { kind: "condition", field: "project_success", operator: "eq", value: 1 },
    ],
  });
  const compiled = compileWorkspaceSegmentFilter(f.workspaceId, filter);
  const matches = () =>
    env.DB.prepare(compiled.sql)
      .bind(...compiled.params)
      .all();
  expect((await matches()).results).toHaveLength(0);
  await service.mutateProjectMember(createDatabase(env.DB), f, {
    projectId: f.projectId,
    contactId: f.contactId,
    statusId: "attended",
    source: "manual",
    idempotencyKey: crypto.randomUUID(),
  });
  expect((await matches()).results).toHaveLength(1);
  await service.mutateProjectMember(createDatabase(env.DB), f, {
    projectId: f.projectId,
    contactId: f.contactId,
    statusId: "absent",
    source: "manual",
    mode: "correction",
    reason: "Wrong contact checked in",
    idempotencyKey: crypto.randomUUID(),
  });
  expect((await matches()).results).toHaveLength(0);
});

it("keeps member operations available while requiring brief reopening and reapproval for definition changes", async () => {
  const { seedWorkspaceContext } = await import("./factory");
  const { addProjectBriefMember, projectBriefInput } = await import("./project-brief-test-support");
  const { createProjectBrief, submitProjectBrief, reviewProjectBrief, reopenProjectBrief } =
    await import("../src/projects/project-brief-service");
  const { ProjectProgramRepository, ProjectMemberRepository } =
    await import("@openengage/database/projects");
  const { getProgramDetail } = await import("../src/projects/program-service");
  const owner = await seedWorkspaceContext(env.DB, "program-owner");
  const reviewer = await addProjectBriefMember(owner, "program-reviewer", "marketer");
  const database = createDatabase(env.DB);
  const { id } = await createProjectBrief(
    database,
    owner,
    projectBriefInput(owner.userId, reviewer.userId),
  );
  const programs = new ProjectProgramRepository(database, owner);
  await programs.save(owner, id, {
    definition: PROJECT_PROGRAM_TEMPLATES.event,
    expectedRowVersion: 0,
  });
  await expect(programs.publish(owner, id, 1)).rejects.toThrow(/approval/);
  await submitProjectBrief(database, owner, id);
  await reviewProjectBrief(database, reviewer, id, "approved", "Confirmed");
  await programs.publish(owner, id, 1);
  await expect(
    programs.save(owner, id, {
      definition: PROJECT_PROGRAM_TEMPLATES.inquiry,
      expectedRowVersion: 2,
    }),
  ).rejects.toThrow(/draft/);
  const contactId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO contacts(id,workspace_id,email,created_at,updated_at) VALUES(?,?,'approved-program@example.com',?,?)",
  )
    .bind(contactId, owner.workspaceId, now, now)
    .run();
  await new ProjectMemberRepository(database, owner).mutate({
    projectId: id,
    contactId,
    source: "manual",
    idempotencyKey: crypto.randomUUID(),
  });
  expect((await programs.brief(id))?.status).toBe("approved");
  const viewer = await addProjectBriefMember(owner, "program-viewer", "viewer");
  expect((await getProgramDetail(database, viewer, id)).allowedActions).toEqual({
    manageMembers: false,
    editDefinition: false,
    publishDefinition: false,
  });
  await reopenProjectBrief(database, owner, id);
  await programs.save(owner, id, {
    definition: PROJECT_PROGRAM_TEMPLATES.inquiry,
    expectedRowVersion: 2,
  });
  expect((await programs.get(id))?.publishedDefinition).toEqual(PROJECT_PROGRAM_TEMPLATES.event);
});

it("rejects cross-workspace form intents and mismatched measurement context and resolves clone intent only after program publication", async () => {
  const { FormProgramRepository, formProgramBindings } =
    await import("@openengage/database/projects");
  const f = await fixture();
  const foreign = await fixture();
  const repository = new FormProgramRepository(createDatabase(env.DB), f);
  await f.client.projects.programSave({
    id: f.projectId,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  const form = await f.client.website.createForm({
    name: "Draft clone form",
    slug: "draft-clone-form",
    status: "draft",
    definition: {},
    allowedDomains: [],
    turnstileEnabled: false,
    successMessage: "Thanks",
  });
  await createDatabase(env.DB).orm.insert(formProgramBindings).values({
    workspaceId: f.workspaceId,
    formId: form.id,
    projectId: f.projectId,
    definitionVersion: null,
    statusId: "registered",
    updatedAt: new Date().toISOString(),
  });
  await expect(repository.get(form.id)).rejects.toThrow(/Publish the destination program/);
  await f.client.projects.programPublish({
    id: f.projectId,
    expectedRowVersion: 1,
    confirmed: true,
  });
  const binding = await repository.get(form.id);
  expect(binding).toEqual({ projectId: f.projectId, definitionVersion: 1, statusId: "registered" });
  await expect(repository.validate(binding!, foreign.projectId)).rejects.toThrow(/measurement/);
  await expect(
    new FormProgramRepository(createDatabase(env.DB), foreign).validate(binding!),
  ).rejects.toThrow(/not found/);
  expect(await new FormProgramRepository(createDatabase(env.DB), foreign).get(form.id)).toBeNull();
});
