import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { createDatabase } from "@openengage/database/client";
import { FormProgramRepository } from "@openengage/database/projects";
import { PublicFormRepository } from "@openengage/database/web";

import {
  createProjectBrief,
  reviewProjectBrief,
  submitProjectBrief,
} from "../src/projects/project-brief-service";
import { createSessionFixtureClient, seedMember, seedWorkspaceClient } from "./factory";
import { programFixture } from "./program-test-support";
import { addProjectBriefMember, projectBriefInput } from "./project-brief-test-support";

const formInput = {
  name: "Program recovery form",
  slug: "program-recovery",
  status: "draft" as const,
  definition: {
    fields: [
      { key: "email", kind: "standard" as const, type: "email" as const, required: true },
      { key: "firstName", kind: "standard" as const, type: "text" as const },
    ],
  },
  turnstileEnabled: false,
};

async function publishProgram(f: Awaited<ReturnType<typeof seedWorkspaceClient>>, id: string) {
  await f.client.projects.programSave({
    id,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  await f.client.projects.programPublish({ id, expectedRowVersion: 1, confirmed: true });
}

function submit(slug: string, body: Record<string, unknown>, key = crypto.randomUUID()) {
  return exports.default.fetch(
    new Request(`http://localhost:8787/f/${slug}/${formInput.slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    }),
  );
}

async function submissionState(workspaceId: string) {
  const tables = [
    "contacts",
    "form_submissions",
    "project_members",
    "project_member_commands",
    "project_member_transitions",
    "contact_events",
    "contact_event_outbox",
    "contact_event_projections",
    "site_visitors",
    "visitor_bindings",
  ];
  return Promise.all(
    tables.map(
      async (table) =>
        (
          await env.DB.prepare(`SELECT * FROM ${table} WHERE workspace_id = ?`)
            .bind(workspaceId)
            .all()
        ).results,
    ),
  );
}

it.each([false, true])(
  "returns a declared form error for a member branch conflict without partial writes (consent: %s)",
  async (consent) => {
    const f = await programFixture();
    await publishProgram(f, f.projectId);
    await f.client.projects.memberMutate({
      id: f.projectId,
      contactId: f.contactId,
      statusId: "absent",
      idempotencyKey: crypto.randomUUID(),
    });
    const form = await f.client.website.createForm(formInput);
    await f.client.projects.programBindForm({
      id: f.projectId,
      formId: form.id,
      binding: { projectId: f.projectId, definitionVersion: 1, statusId: "attended" },
      confirmed: true,
    });
    await f.client.website.updateForm({ ...formInput, id: form.id, status: "published" });
    const contact = await f.client.contacts.get({ id: f.contactId });
    const before = await submissionState(f.workspaceId);
    const key = crypto.randomUUID();
    const body = { email: contact.email, firstName: "Must not persist", consent };
    const response = await submit(f.slug, body, key);
    expect.soft(response.status).toBe(422);
    expect.soft(await response.json()).toMatchObject({ error: { code: "invalid_payload" } });
    expect(await submissionState(f.workspaceId)).toEqual(before);

    // A failed submission must not consume its key or leave a visitor binding behind.
    await f.client.projects.programBindForm({
      id: f.projectId,
      formId: form.id,
      binding: { projectId: f.projectId, definitionVersion: 1, statusId: "absent" },
      confirmed: true,
    });
    await f.client.website.updateForm({ ...formInput, id: form.id, status: "published" });
    expect((await submit(f.slug, body, key)).status).toBe(202);
    expect((await f.client.contacts.get({ id: f.contactId })).firstName).toBe("Must not persist");
    expect((await f.client.website.listForms())[0]?.submissionCount).toBe(1);
    expect(
      await f.client.projects.memberHistory({ id: f.projectId, contactId: f.contactId }),
    ).toHaveLength(1);
  },
);

async function approvedBindingFixture() {
  const f = await seedWorkspaceClient(env.DB);
  await seedMember(env.DB, f);
  const owner = { ...f, role: "owner" as const };
  const reviewer = await addProjectBriefMember(owner, "binding-reviewer", "marketer");
  const database = createDatabase(env.DB);
  const project = await createProjectBrief(
    database,
    owner,
    projectBriefInput(f.userId, reviewer.userId),
  );
  await f.client.projects.programSave({
    id: project.id,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  await submitProjectBrief(database, owner, project.id);
  await reviewProjectBrief(database, reviewer, project.id, "approved", "Ready");
  await f.client.projects.programPublish({
    id: project.id,
    expectedRowVersion: 1,
    confirmed: true,
  });
  const form = await f.client.website.createForm(formInput);
  const binding = { projectId: project.id, definitionVersion: 1, statusId: "registered" };
  await f.client.projects.programBindForm({
    id: project.id,
    formId: form.id,
    binding,
    confirmed: true,
  });
  await f.client.website.updateForm({ ...formInput, id: form.id, status: "published" });
  return {
    ...f,
    owner,
    reviewer,
    projectId: project.id,
    formId: form.id,
    binding,
    bindings: new FormProgramRepository(database, f),
    publicForms: new PublicFormRepository(database),
  };
}

it("clears an archived approved project's binding and republishes the form unbound", async () => {
  const f = await approvedBindingFixture();
  await f.client.projects.briefArchive({ id: f.projectId });
  await f.client.projects.programBindForm({
    id: f.projectId,
    formId: f.formId,
    binding: null,
    confirmed: true,
  });
  expect(await f.bindings.getIntent(f.formId)).toBeNull();
  expect((await f.publicForms.findPublishedForm(f.slug, formInput.slug))?.programBinding).toEqual(
    f.binding,
  );
  await f.client.website.updateForm({ ...formInput, id: f.formId, status: "published" });
  expect(
    (await f.publicForms.findPublishedForm(f.slug, formInput.slug))?.programBinding,
  ).toBeNull();
  expect((await submit(f.slug, { email: "unbound@example.com" })).status).toBe(202);
  expect(
    (
      await env.DB.prepare("SELECT * FROM project_members WHERE workspace_id = ?")
        .bind(f.workspaceId)
        .all()
    ).results,
  ).toHaveLength(0);
});

it("rebinds an archived approved project's form to an active program and republishes", async () => {
  const f = await approvedBindingFixture();
  await f.client.projects.briefArchive({ id: f.projectId });
  const destination = await f.client.projects.create({ name: "Replacement event" });
  await publishProgram(f, destination.id);
  const binding = { projectId: destination.id, definitionVersion: 1, statusId: "registered" };
  const other = await addProjectBriefMember(f.owner, "archived-binding-marketer", "marketer");
  const { client } = await createSessionFixtureClient(env.DB, other);
  for (const change of [
    { id: f.projectId, binding: null },
    { id: destination.id, binding },
  ]) {
    await expect(
      client.projects.programBindForm({ ...change, formId: f.formId, confirmed: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  await f.client.projects.programBindForm({
    id: destination.id,
    formId: f.formId,
    binding,
    confirmed: true,
  });
  expect(await f.bindings.getIntent(f.formId)).toEqual(binding);
  expect((await f.publicForms.findPublishedForm(f.slug, formInput.slug))?.programBinding).toEqual(
    f.binding,
  );
  await f.client.website.updateForm({ ...formInput, id: f.formId, status: "published" });
  expect((await f.publicForms.findPublishedForm(f.slug, formInput.slug))?.programBinding).toEqual(
    binding,
  );
  expect((await submit(f.slug, { email: "rebound@example.com" })).status).toBe(202);
  expect(
    (await f.client.projects.memberList({ id: destination.id })).items[0]?.member,
  ).toMatchObject({ statusId: "registered" });
});

it("preserves active approval and ownership guards when clearing or replacing bindings", async () => {
  const f = await approvedBindingFixture();
  const destination = await f.client.projects.create({ name: "Other event" });
  await publishProgram(f, destination.id);
  await expect(
    f.client.projects.programBindForm({
      id: destination.id,
      formId: f.formId,
      binding: { projectId: destination.id, definitionVersion: 1, statusId: "registered" },
      confirmed: true,
    }),
  ).rejects.toMatchObject({ code: "PROGRAM_CONFLICT" });
  const other = await addProjectBriefMember(f.owner, "other-marketer", "marketer");
  const { client } = await createSessionFixtureClient(env.DB, other);
  await expect(
    client.projects.programBindForm({
      id: f.projectId,
      formId: f.formId,
      binding: null,
      confirmed: true,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.client.projects.briefReopen({ id: f.projectId });
  for (const binding of [null, f.binding]) {
    await expect(
      f.client.projects.programBindForm({
        id: f.projectId,
        formId: f.formId,
        binding,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  expect(await f.bindings.getIntent(f.formId)).toEqual(f.binding);
});

it("requires the active destination's approval when recovering an archived binding", async () => {
  const f = await approvedBindingFixture();
  await f.client.projects.briefArchive({ id: f.projectId });
  const database = createDatabase(env.DB);
  const destination = await createProjectBrief(
    database,
    f.owner,
    projectBriefInput(f.userId, f.reviewer.userId),
  );
  await f.client.projects.programSave({
    id: destination.id,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  await submitProjectBrief(database, f.owner, destination.id);
  await reviewProjectBrief(database, f.reviewer, destination.id, "approved", "Ready");
  await f.client.projects.programPublish({
    id: destination.id,
    expectedRowVersion: 1,
    confirmed: true,
  });
  await f.client.projects.briefReopen({ id: destination.id });
  await expect(
    f.client.projects.programBindForm({
      id: destination.id,
      formId: f.formId,
      binding: { projectId: destination.id, definitionVersion: 1, statusId: "registered" },
      confirmed: true,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await f.bindings.getIntent(f.formId)).toEqual(f.binding);
});

it("keeps archived binding recovery within its workspace and rejects archived destinations", async () => {
  const f = await approvedBindingFixture();
  await f.client.projects.briefArchive({ id: f.projectId });
  await expect(
    f.client.projects.programBindForm({
      id: f.projectId,
      formId: f.formId,
      binding: f.binding,
      confirmed: true,
    }),
  ).rejects.toMatchObject({ code: "PROGRAM_NOT_FOUND" });
  const foreign = await programFixture();
  await publishProgram(foreign, foreign.projectId);
  await expect(
    foreign.client.projects.programBindForm({
      id: f.projectId,
      formId: f.formId,
      binding: null,
      confirmed: true,
    }),
  ).rejects.toMatchObject({ code: "PROGRAM_NOT_FOUND" });
  for (const binding of [
    null,
    { projectId: foreign.projectId, definitionVersion: 1, statusId: "registered" },
  ]) {
    await expect(
      foreign.client.projects.programBindForm({
        id: foreign.projectId,
        formId: f.formId,
        binding,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "PROGRAM_NOT_FOUND" });
  }
  expect(await f.bindings.getIntent(f.formId)).toEqual(f.binding);
});
