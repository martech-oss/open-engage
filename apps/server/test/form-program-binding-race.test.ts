import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { FormProgramRepository, ProgramError } from "@openengage/database/projects";

import { programFixture } from "./program-test-support";

async function publishedProgram(f: Awaited<ReturnType<typeof programFixture>>, name: string) {
  const project = await f.client.projects.create({ name });
  await f.client.projects.programSave({
    id: project.id,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  await f.client.projects.programPublish({
    id: project.id,
    expectedRowVersion: 1,
    confirmed: true,
  });
  return project.id;
}

async function fixture() {
  const f = await programFixture();
  const first = await publishedProgram(f, "First");
  const second = await publishedProgram(f, "Second");
  const form = await f.client.website.createForm({
    name: "Binding race form",
    slug: "binding-race",
    status: "draft",
    definition: { fields: [{ key: "email", kind: "standard", type: "email", required: true }] },
    turnstileEnabled: false,
  });
  const repository = new FormProgramRepository(env.DB, { workspaceId: f.workspaceId });
  const binding = (projectId: string) => ({
    projectId,
    definitionVersion: 1,
    statusId: "registered",
  });
  return { ...f, first, second, formId: form.id, repository, binding };
}

it("refuses a binding write when the owner it was authorized against has changed", async () => {
  const f = await fixture();
  // Authorized while the form was unbound, but another request bound it first.
  await f.repository.set(f.formId, f.binding(f.first), null);
  await expect(f.repository.set(f.formId, f.binding(f.second), null)).rejects.toMatchObject({
    code: "conflict",
  });
  // Authorized against the second Project, but the first still owns it.
  await expect(f.repository.set(f.formId, f.binding(f.second), f.second)).rejects.toBeInstanceOf(
    ProgramError,
  );
  await expect(f.repository.set(f.formId, null, f.second)).resolves.toBeUndefined();
  await expect(f.repository.getIntent(f.formId)).resolves.toMatchObject({ projectId: f.first });

  await f.repository.set(f.formId, f.binding(f.second), f.first);
  await expect(f.repository.getIntent(f.formId)).resolves.toMatchObject({ projectId: f.second });
});

it("releases only the requested form's binding", async () => {
  const f = await fixture();
  const other = await f.client.website.createForm({
    name: "Second form",
    slug: "binding-race-other",
    status: "draft",
    definition: { fields: [{ key: "email", kind: "standard", type: "email", required: true }] },
    turnstileEnabled: false,
  });
  await f.repository.set(f.formId, f.binding(f.first), null);
  await f.repository.set(other.id, f.binding(f.first), null);
  await f.repository.set(f.formId, null, f.first);
  await expect(f.repository.getIntent(f.formId)).resolves.toBeNull();
  await expect(f.repository.getIntent(other.id)).resolves.toMatchObject({ projectId: f.first });
});

it("refuses to bind a form to a Project archived after the permission check", async () => {
  const f = await fixture();
  await env.DB.prepare("UPDATE projects SET archived_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), f.second)
    .run();
  await expect(f.repository.set(f.formId, f.binding(f.second), null)).rejects.toBeInstanceOf(
    ProgramError,
  );
  await expect(f.repository.getIntent(f.formId)).resolves.toBeNull();
});
