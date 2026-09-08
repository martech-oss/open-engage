import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { ProjectCloneQueryRepository } from "@openengage/database/projects";

import { seedWorkspaceClient } from "./factory";
import { cloneOptions, finishClone } from "./project-clone-test-support";

async function fixture(event: "form_submitted" | "custom_event" = "form_submitted") {
  const f = await seedWorkspaceClient(env.DB);
  const project = await f.client.projects.create({ name: "Decision source" });
  const form = await f.client.website.createForm({
    name: "Decision form",
    slug: "decision-form",
    status: "published",
    turnstileEnabled: false,
    definition: { fields: [{ key: "email", type: "email", label: "Email" }] },
  });
  const automation = await f.client.automations.create({
    name: "Wait for form",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "contact_created" },
      },
      {
        id: "wait",
        type: "decision",
        position: { x: 200, y: 0 },
        config: { event, resourceId: form.id, withinMinutes: 60 },
      },
    ],
    edges: [{ id: "start", source: "source", target: "wait", branch: "next" }],
  });
  await f.client.automations.publish({ id: automation.id });
  await f.client.projects.addItem({
    id: project.id,
    resourceType: "automation",
    resourceId: automation.id,
  });
  return { ...f, project, form, automation };
}

it("discloses a decision's shared form and rejects materialization if it is deleted after preview", async () => {
  const f = await fixture();
  const clone = await f.client.projects.clonePreview({ id: f.project.id, options: cloneOptions });
  expect(clone.sharedReferences).toContainEqual(
    expect.objectContaining({ kind: "form", id: f.form.id, name: "Decision form" }),
  );
  expect(clone.resources.some((resource) => resource.sourceId === f.form.id)).toBe(false);
  await env.DB.prepare("DELETE FROM forms WHERE id=?").bind(f.form.id).run();
  await expect(finishClone(f, f.project.id, clone.id)).rejects.toThrow();
  expect((await new ProjectCloneQueryRepository(env.DB, f).get(clone.id))?.status).toBe("failed");
  expect(
    await env.DB.prepare("SELECT id FROM projects WHERE id=?").bind(clone.targetProjectId).first(),
  ).toBeNull();
});

it("remaps an included decision form without exposing it as a shared dependency", async () => {
  const f = await fixture();
  await f.client.projects.addItem({
    id: f.project.id,
    resourceType: "form",
    resourceId: f.form.id,
  });
  const clone = await f.client.projects.clonePreview({ id: f.project.id, options: cloneOptions });
  expect(clone.sharedReferences.some((reference) => reference.id === f.form.id)).toBe(false);
  await finishClone(f, f.project.id, clone.id);
  const copiedAutomation = clone.resources.find((resource) => resource.kind === "automation")!;
  const copiedForm = clone.resources.find((resource) => resource.kind === "form")!;
  const draft = await f.client.automations.getDraft({ id: copiedAutomation.targetId });
  expect(draft.graph.nodes.find((node) => node.id === "wait")?.config).toMatchObject({
    resourceId: copiedForm.targetId,
  });
});

it("does not interpret a custom event's resource identifier as a form dependency", async () => {
  const f = await fixture("custom_event");
  await env.DB.prepare("DELETE FROM forms WHERE id=?").bind(f.form.id).run();
  const clone = await f.client.projects.clonePreview({ id: f.project.id, options: cloneOptions });
  expect(clone.sharedReferences.some((reference) => reference.kind === "form")).toBe(false);
  await finishClone(f, f.project.id, clone.id);
});

it("preserves a custom event literal even when it equals an included form ID", async () => {
  const f = await fixture("custom_event");
  await f.client.projects.addItem({
    id: f.project.id,
    resourceType: "form",
    resourceId: f.form.id,
  });
  const clone = await f.client.projects.clonePreview({ id: f.project.id, options: cloneOptions });
  expect(clone.sharedReferences.some((reference) => reference.id === f.form.id)).toBe(false);
  await finishClone(f, f.project.id, clone.id);
  const copiedAutomation = clone.resources.find((resource) => resource.kind === "automation")!;
  const copiedForm = clone.resources.find((resource) => resource.kind === "form")!;
  expect(copiedForm.targetId).not.toBe(f.form.id);
  const draft = await f.client.automations.getDraft({ id: copiedAutomation.targetId });
  expect(draft.graph.nodes.find((node) => node.id === "wait")?.config).toMatchObject({
    resourceId: f.form.id,
  });
});
