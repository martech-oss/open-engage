import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";

import { seedWorkspaceClient } from "./factory";

it("isolates malformed drafts and retains valid references and diagnostics in partially invalid resources", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  await client.projects.variablesSave({
    projectId: null,
    key: "title",
    type: "string",
    value: "before",
    expectedRevision: 0,
  });
  const malformed = await client.website.createForm({
    name: "Malformed",
    status: "draft",
    definition: {},
    turnstileEnabled: false,
    successMessage: "{{variables.bad-key}}",
  });
  expect(await client.projects.variablesUses({ projectId: null, key: "title" })).toEqual([]);
  expect(
    await client.projects.variablesImpact({
      projectId: null,
      key: "title",
      type: "string",
      value: "after",
      expectedRevision: 1,
    }),
  ).toEqual([]);
  expect(await client.projects.variablesUses({ projectId: null })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        resourceId: malformed.id,
        references: [],
        diagnostics: ["Invalid variable expression"],
      }),
    ]),
  );
  const partial = await client.website.createForm({
    name: "Partial",
    status: "draft",
    definition: {},
    turnstileEnabled: false,
    successMessage: "{{variables.bad-key}} {{variables.title}}",
  });
  const page = await client.website.createPage({
    name: "Partial LP",
    document: {
      ...emptyLandingPageDocument(),
      title: "{{variables.bad-key}} {{variables.title}}",
    },
  });
  const auto = await client.automations.create({
    name: "Partial auto",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "api_event", eventName: "start" },
      },
      {
        id: "handoff",
        type: "action",
        position: { x: 1, y: 0 },
        config: { action: "handoff_to_sales", title: "{{variables.bad-key}} {{variables.title}}" },
      },
    ],
    edges: [{ id: "edge", source: "source", target: "handoff", branch: "next" }],
  });
  const uses = await client.projects.variablesUses({ projectId: null, key: "title" });
  expect(uses.map((use) => use.resourceId).sort()).toEqual([partial.id, page.id, auto.id].sort());
  for (const use of uses)
    expect(use).toMatchObject({
      references: [{ kind: "variable", key: "title", type: "string" }],
      diagnostics: ["Invalid variable expression"],
    });
  const impact = await client.projects.variablesImpact({
    projectId: null,
    key: "title",
    type: "string",
    value: "after",
    expectedRevision: 1,
  });
  expect(impact).toHaveLength(3);
  expect(impact.every((use) => use.before === "before" && use.after === "after")).toBe(true);
  await expect(
    client.website.updateForm({
      id: partial.id,
      slug: "partial",
      name: "Partial",
      status: "published",
      definition: {},
      turnstileEnabled: false,
      successMessage: "{{variables.bad-key}} {{variables.title}}",
    }),
  ).rejects.toMatchObject({ code: "FORM_VARIABLE_INVALID" });
});

it("reports inherited nested calls on the parent with draft context and frozen published before values", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  const project = await client.projects.create({
    name: "Parent scope",
    description: "",
    color: "#123456",
  });
  await client.projects.variablesSave({
    projectId: null,
    key: "wait",
    type: "number",
    value: 5,
    expectedRevision: 0,
  });
  await client.projects.variablesSave({
    projectId: project.id,
    key: "wait",
    type: "number",
    value: 10,
    expectedRevision: 0,
  });
  const source = {
    id: "source",
    type: "source" as const,
    position: { x: 0, y: 0 },
    config: { source: "callable" as const },
  };
  const leaf = await client.automations.create({
    name: "Leaf",
    nodes: [
      source,
      {
        id: "delay",
        type: "delay",
        position: { x: 1, y: 0 },
        config: { mode: "relative", minutes: { kind: "variable", key: "wait", type: "number" } },
      },
    ],
    edges: [{ id: "edge", source: "source", target: "delay", branch: "next" }],
  });
  await client.automations.publish({ id: leaf.id });
  const call = (id: string, automationId: string) => ({
    id,
    type: "action" as const,
    position: { x: 1, y: 0 },
    config: { action: "call_automation" as const, automationId, mode: "await" as const },
  });
  const middleDefinition = {
    name: "Middle",
    nodes: [source, call("nested", leaf.id)],
    edges: [{ id: "edge", source: "source", target: "nested", branch: "next" as const }],
  };
  const middle = await client.automations.create(middleDefinition);
  await client.automations.publish({ id: middle.id });
  const parentDefinition = {
    name: "Parent",
    variableProjectId: project.id,
    nodes: [
      { ...source, config: { source: "api_event" as const, eventName: "start" } },
      call("first", middle.id),
      call("second", middle.id),
    ],
    edges: [
      { id: "e1", source: "source", target: "first", branch: "next" as const },
      { id: "e2", source: "first", target: "second", branch: "next" as const },
    ],
  };
  const parent = await client.automations.create(parentDefinition);
  const input = {
    projectId: project.id,
    key: "wait",
    type: "number" as const,
    value: 20,
    expectedRevision: 1,
  };
  const draft = await client.projects.variablesImpact(input);
  expect(draft).toHaveLength(2);
  expect(draft.map((use) => use.dependencyPath)).toEqual([
    ["call:first", "call:nested"],
    ["call:second", "call:nested"],
  ]);
  for (const use of draft)
    expect(use).toMatchObject({
      resourceId: parent.id,
      published: false,
      projectId: project.id,
      before: 10,
      after: 20,
      snapshot: null,
    });
  const published = await client.automations.publish({ id: parent.id });
  const frozen = (await client.projects.variablesImpact(input)).filter((use) => use.published);
  expect(frozen).toHaveLength(2);
  for (const use of frozen)
    expect(use).toMatchObject({
      resourceId: parent.id,
      versionId: published.publishedVersionId,
      published: true,
      before: 10,
      after: 20,
      requiresRepublish: true,
    });
  await client.projects.variablesSave({ ...input, value: 15 });
  await client.automations.saveDraft({
    id: leaf.id,
    name: "Leaf without variables",
    nodes: [source],
    edges: [],
  });
  await client.automations.publish({ id: leaf.id });
  // The current middle still pins the old leaf, even for a new parent's draft.
  await client.automations.saveDraft({ id: parent.id, ...parentDefinition });
  const withDraft = await client.projects.variablesImpact({ ...input, expectedRevision: 2 });
  expect(withDraft.filter((use) => !use.published)).toHaveLength(2);
  expect(withDraft.filter((use) => !use.published).every((use) => use.before === 15)).toBe(true);
  await client.automations.saveDraft({ id: middle.id, ...middleDefinition });
  await client.automations.publish({ id: middle.id });
  const oldOnly = await client.projects.variablesImpact({ ...input, expectedRevision: 2 });
  expect(oldOnly).toHaveLength(2);
  expect(oldOnly.every((use) => use.published && use.before === 10 && use.after === 20)).toBe(true);
});

it("attributes LP shared form uses to the form context and preserves its pinned before snapshot", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  const project = await client.projects.create({
    name: "Shared scope",
    description: "",
    color: "#123456",
  });
  await client.projects.variablesSave({
    projectId: project.id,
    key: "title",
    type: "string",
    value: "before",
    expectedRevision: 0,
  });
  await client.projects.variablesSave({
    projectId: null,
    key: "title",
    type: "string",
    value: "Workspace",
    expectedRevision: 0,
  });
  const form = await client.website.createForm({
    name: "Shared",
    status: "draft",
    variableProjectId: project.id,
    definition: {},
    turnstileEnabled: false,
    successMessage: "{{variables.title}}",
  });
  const document = {
    ...emptyLandingPageDocument(),
    html: '<div data-oe-form="signup"></div>',
    forms: [
      {
        refId: "signup",
        formId: form.id,
        name: "{{variables.title}}",
        definition: { progressiveMaxFields: 3 },
        turnstileEnabled: false,
        successMessage: "{{variables.title}}",
      },
    ],
  };
  const page = await client.website.createPage({ name: "Shared form LP", document });
  const input = {
    projectId: project.id,
    key: "title",
    type: "string" as const,
    value: "after",
    expectedRevision: 1,
  };
  const uses = await client.projects.variablesUses({ projectId: project.id, key: "title" });
  expect(uses.find((use) => use.resourceId === page.id)).toMatchObject({
    projectId: project.id,
    published: false,
    dependencyPath: ["form:signup"],
  });
  expect(
    (await client.projects.variablesImpact(input)).find((use) => use.resourceId === page.id),
  ).toMatchObject({ before: "before", after: "after", published: false });
  await client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  await client.projects.variablesSave({ ...input, value: "edited" });
  await client.website.updateForm({
    id: form.id,
    slug: "shared",
    name: "Shared",
    status: "draft",
    variableProjectId: null,
    definition: {},
    turnstileEnabled: false,
    successMessage: "{{variables.title}}",
  });
  const next = await client.website.updatePage({
    id: page.id,
    slug: "shared-form-lp",
    name: "Shared form LP",
    document,
    baseVersionId: page.versionId,
  });
  const publishedUses = (
    await client.projects.variablesImpact({ ...input, expectedRevision: 2 })
  ).filter((use) => use.resourceId === page.id);
  expect(publishedUses).toHaveLength(1);
  expect(publishedUses[0]).toMatchObject({
    projectId: project.id,
    versionId: page.versionId,
    published: true,
    before: "before",
    after: "after",
    requiresRepublish: true,
  });
  const workspaceUses = (
    await client.projects.variablesImpact({
      projectId: null,
      key: "title",
      type: "string",
      value: "new default",
      expectedRevision: 1,
    })
  ).filter((use) => use.resourceId === page.id);
  expect(workspaceUses.find((use) => use.versionId === next.versionId)).toMatchObject({
    projectId: null,
    published: false,
    before: "Workspace",
    after: "new default",
  });
  expect(workspaceUses.find((use) => use.versionId === page.versionId)).toMatchObject({
    projectId: project.id,
    before: "before",
    after: "edited",
  });
});
