import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { emptyLandingPageDocument } from "@openengage/core/web";

import type { RuntimeEnv } from "../src/env";
import { processLandingGeneration } from "../src/web/landing-generation-service";
import { seedWorkspaceClient } from "./factory";
import { cloneOptions, finishClone, postCloneForm } from "./project-clone-test-support";

async function programFixture() {
  const fixture = await seedWorkspaceClient(env.DB);
  const project = await fixture.client.projects.create({ name: "Event" });
  await fixture.client.projects.programSave({
    id: project.id,
    expectedRowVersion: 0,
    definition: PROJECT_PROGRAM_TEMPLATES.event,
  });
  await fixture.client.projects.programPublish({
    id: project.id,
    expectedRowVersion: 1,
    confirmed: true,
  });
  const form = await fixture.client.website.createForm({
    name: "Registration",
    slug: "registration",
    status: "published",
    turnstileEnabled: false,
    definition: { fields: [{ key: "email", type: "email", label: "Email" }] },
  });
  const bind = (statusId: string) =>
    fixture.client.projects.programBindForm({
      id: project.id,
      formId: form.id,
      binding: { projectId: project.id, definitionVersion: 1, statusId },
      confirmed: true,
    });
  return { ...fixture, project, form, bind };
}

it("clones a published LP, publishes it and submits once to its frozen destination program binding", async () => {
  const f = await programFixture();
  await f.bind("registered");
  const document = {
    ...emptyLandingPageDocument("Frozen LP"),
    measurement: { projectId: f.project.id, primaryConversion: "form_submitted" as const },
    html: '<main><div data-oe-form="signup"></div></main>',
    forms: [
      {
        refId: "signup",
        formId: f.form.id,
        name: "Signup",
        definition: { fields: [{ key: "email", type: "email" as const, label: "Frozen email" }] },
        successMessage: "Frozen thanks",
        turnstileEnabled: false,
      },
    ],
  };
  const page = await f.client.website.createPage({ name: "LP", slug: "lp", document });
  await f.client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  const sourceBinding = (await f.client.website.getPageDesign({ id: page.id })).versions[0]!
    .formBindings[0]!;
  // The reusable form's newer intent must not override the LP's published binding.
  await f.bind("attended");
  await f.client.projects.addItem({
    id: f.project.id,
    resourceType: "landing_page",
    resourceId: page.id,
  });
  const clone = await f.client.projects.clonePreview({ id: f.project.id, options: cloneOptions });
  await finishClone(f, f.project.id, clone.id);
  await f.client.projects.programPublish({
    id: clone.targetProjectId,
    expectedRowVersion: 1,
    confirmed: true,
  });
  const copiedPage = clone.resources.find((r) => r.kind === "landing_page")!;
  const copiedVersion = clone.resources.find(
    (r) => r.kind === "landing_page_version" && r.sourceId === page.versionId,
  )!;
  const publication = {
    id: copiedPage.targetId,
    versionId: copiedVersion.targetId,
    baseVersionId: copiedVersion.targetId,
  };
  await f.client.website.publishPage(publication);
  await f.client.website.publishPage(publication);
  const design = await f.client.website.getPageDesign({ id: copiedPage.targetId });
  const binding = design.versions[0]!.formBindings[0]!;
  expect(binding.formId).not.toBe(sourceBinding.formId);
  const resolved = await postCloneForm(
    `/api/public/landing/${f.slug}/${copiedPage.targetSlug}/resolve`,
    { consent: true },
  );
  expect(resolved.status).toBe(200);
  const { data } = (await resolved.json()) as {
    data: { visitorToken: string; measurementToken: string; html: string };
  };
  const iframe = /<iframe[^>]+src="([^"]+)"/.exec(data.html)![1]!.replaceAll("&amp;", "&");
  const renderedForm = await exports.default.fetch(new Request(iframe));
  expect(renderedForm.status).toBe(200);
  expect(await renderedForm.text()).toContain("Frozen email");
  const body = {
    email: "cloned-registration@example.com",
    consent: true,
    oe_v: data.visitorToken,
    measurementToken: data.measurementToken,
    idempotencyKey: crypto.randomUUID(),
  };
  const path = `/f/${f.slug}/lp-${binding.formId}`;
  expect((await postCloneForm(path, body)).status).toBe(202);
  expect((await postCloneForm(path, body)).status).toBe(202);
  const contact = await env.DB.prepare(
    "SELECT id,acquisition_project_id FROM contacts WHERE workspace_id=? AND email=?",
  )
    .bind(f.workspaceId, body.email)
    .first<{ id: string; acquisition_project_id: string }>();
  expect(contact?.acquisition_project_id).toBe(clone.targetProjectId);
  const history = await f.client.projects.memberHistory({
    id: clone.targetProjectId,
    contactId: contact!.id,
  });
  expect(history).toHaveLength(1);
  expect(history[0]?.statusId).toBe("registered");
  expect((await f.client.projects.memberList({ id: f.project.id })).total).toBe(0);
  const event = await env.DB.prepare(
    "SELECT properties FROM contact_events WHERE workspace_id=? AND contact_id=? AND type='form_submitted'",
  )
    .bind(f.workspaceId, contact!.id)
    .first<{ properties: string }>();
  expect(JSON.parse(event!.properties)).toMatchObject({
    pageId: copiedPage.targetId,
    pageVersionId: copiedVersion.targetId,
    formId: binding.formId,
    formVersionId: binding.formVersionId,
  });
  expect(
    (await f.client.website.getPageDesign({ id: page.id })).versions[0]!.formBindings[0],
  ).toEqual(sourceBinding);
});

it("keeps a published form unbound when only its draft intent acquired a program", async () => {
  const f = await programFixture();
  await f.bind("registered");
  await f.client.projects.addItem({
    id: f.project.id,
    resourceType: "form",
    resourceId: f.form.id,
  });
  const clone = await f.client.projects.clonePreview({ id: f.project.id, options: cloneOptions });
  expect(clone.resources.filter((r) => r.kind === "form_binding")).toHaveLength(0);
  await finishClone(f, f.project.id, clone.id);
  const copiedForm = clone.resources.find((r) => r.kind === "form")!;
  expect(
    await env.DB.prepare("SELECT * FROM form_program_bindings WHERE form_id=?")
      .bind(copiedForm.targetId)
      .first(),
  ).toBeNull();
});

it("rejects preview when a published form status is missing from the chosen program definition", async () => {
  const f = await programFixture();
  await f.bind("registered");
  // Publish the binding using the normal form write API.
  await f.client.website.updateForm({
    id: f.form.id,
    name: "Registration",
    slug: "registration",
    status: "published",
    turnstileEnabled: false,
    definition: { fields: [{ key: "email", type: "email", label: "Email" }] },
  });
  const current = (await f.client.projects.programGet({ id: f.project.id })).program!;
  await f.client.projects.programSave({
    id: f.project.id,
    expectedRowVersion: current.rowVersion,
    definition: PROJECT_PROGRAM_TEMPLATES.inquiry,
  });
  await f.client.projects.programPublish({
    id: f.project.id,
    expectedRowVersion: current.rowVersion + 1,
    confirmed: true,
  });
  await f.client.projects.addItem({
    id: f.project.id,
    resourceType: "form",
    resourceId: f.form.id,
  });
  await expect(
    f.client.projects.clonePreview({ id: f.project.id, options: cloneOptions }),
  ).rejects.toMatchObject({
    code: "PROJECT_CLONE_CONFLICT",
    message: expect.stringMatching(/Registration.*registered/),
  });
  expect((await f.client.projects.cloneList({ id: f.project.id })).items).toHaveLength(0);
});

it("generates and publishes above all copied experiment versions without changing the source", async () => {
  const f = await seedWorkspaceClient(env.DB);
  const project = await f.client.projects.create({ name: "Experiment" });
  const page = await f.client.website.createPage({
    name: "LP",
    slug: "lp",
    document: emptyLandingPageDocument("A"),
  });
  await f.client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  const next = await f.client.website.updatePage({
    id: page.id,
    name: "LP",
    slug: "lp",
    baseVersionId: page.versionId,
    document: emptyLandingPageDocument("B"),
  });
  await f.client.website.publishPage({
    id: page.id,
    versionId: next.versionId,
    baseVersionId: next.versionId,
  });
  await f.client.website.createExperiment({
    id: crypto.randomUUID(),
    pageId: page.id,
    name: "A/B",
    variants: [
      { id: "a", name: "A", pageVersionId: page.versionId, weight: 50 },
      { id: "b", name: "B", pageVersionId: next.versionId, weight: 50 },
    ],
  });
  await f.client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: next.versionId,
  });
  await f.client.projects.addItem({
    id: project.id,
    resourceType: "landing_page",
    resourceId: page.id,
  });
  const clone = await f.client.projects.clonePreview({ id: project.id, options: cloneOptions });
  await finishClone(f, project.id, clone.id);
  const copiedPage = clone.resources.find((r) => r.kind === "landing_page")!;
  const copiedBase = clone.resources.find(
    (r) => r.kind === "landing_page_version" && r.sourceId === page.versionId,
  )!;
  const generation = await f.client.website.generatePage({
    pageId: copiedPage.targetId,
    baseVersionId: copiedBase.targetId,
    prompt: "Improve headline",
    requestKey: crypto.randomUUID(),
  });
  await processLandingGeneration(generation.id, env as unknown as RuntimeEnv, async () => ({
    document: emptyLandingPageDocument("Generated copy"),
    explanation: "New headline",
    imageRequests: [],
  }));
  const design = await f.client.website.getPageDesign({ id: copiedPage.targetId });
  expect(design.jobs.find((j) => j.id === generation.id)?.status).toBe("completed");
  expect(design.versions.map((v) => v.version)).toEqual([3, 2, 1]);
  expect(design.versions[0]!.document.title).toBe("Generated copy");
  await f.client.website.publishPage({
    id: copiedPage.targetId,
    versionId: design.currentVersionId!,
    baseVersionId: design.currentVersionId!,
  });
  expect((await f.client.website.getPageDesign({ id: page.id })).currentVersionId).toBe(
    next.versionId,
  );
});
