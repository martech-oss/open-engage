import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import * as repositories from "@openengage/database/projects";

import { seedWorkspaceClient } from "./factory";
describe("workspace/project variable persistence", () => {
  it("enforces revisions, inheritance, type consistency and workspace boundaries", async () => {
    expect(repositories.VariableRepository).toBeDefined();
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const project = await client.projects.create({
      name: "Campaign",
      description: "",
      color: "#123456",
    });
    const repository = new repositories.VariableRepository(env.DB, { workspaceId });
    const saved = await repository.save({
      projectId: null,
      key: "title",
      type: "string",
      value: "Default",
      expectedRevision: 0,
    });
    expect(saved.revision).toBe(1);
    await expect(
      repository.save({
        projectId: null,
        key: "title",
        type: "string",
        value: "Stale",
        expectedRevision: 0,
      }),
    ).rejects.toThrow(/conflict/i);
    await repository.save({
      projectId: project.id,
      key: "title",
      type: "string",
      value: "Local",
      expectedRevision: 0,
    });
    expect(
      (await repository.resolve(project.id)).values.find((v) => v.key === "title")?.value,
    ).toBe("Local");
    await expect(
      repository.save({
        projectId: project.id,
        key: "title",
        type: "number",
        value: 2,
        expectedRevision: 1,
      }),
    ).rejects.toThrow(/type/i);
    await expect(
      new repositories.VariableRepository(env.DB, { workspaceId: "foreign" }).resolve(project.id),
    ).rejects.toThrow(/project/i);
    await repository.remove({ projectId: project.id, key: "title", expectedRevision: 1 });
    expect(
      (await repository.resolve(project.id)).values.find((v) => v.key === "title")?.value,
    ).toBe("Default");
  });
});

import { exports } from "cloudflare:workers";

import { emptyLandingPageDocument } from "@openengage/core/web";
import {
  LandingDesignRepository,
  PublicFormRepository,
  SignupFormRepository,
} from "@openengage/database/web";

it("publishes escaped resolved LPs, keeps old versions frozen and only applies edits to a new publication", async () => {
  const { client, workspaceId, slug } = await seedWorkspaceClient(env.DB);
  const variables = new repositories.VariableRepository(env.DB, { workspaceId });
  await variables.save({
    projectId: null,
    key: "title",
    type: "string",
    value: "<img src=x onerror=alert(1)>",
    expectedRevision: 0,
  });
  await variables.save({
    projectId: null,
    key: "target",
    type: "url",
    value: "https://example.com/original",
    expectedRevision: 0,
  });
  const document = {
    ...emptyLandingPageDocument(),
    html: '<h1>{{variables.title}}</h1><a data-oe-cta="cta"></a>',
    ctas: [
      {
        refId: "cta",
        label: "{{variables.title}}",
        href: "https://fallback.example",
        hrefVariable: { kind: "variable" as const, key: "target", type: "url" as const },
      },
    ],
  };
  const page = await client.website.createPage({ name: "Variables", slug: "variables", document });
  await client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  const html = await (
    await exports.default.fetch(new Request(`http://localhost:8787/p/${slug}/variables`))
  ).text();
  expect(html).toContain("&lt;img");
  expect(html).not.toContain('<img src="x"');
  expect(html).toContain("https://example.com/original");
  const repository = new LandingDesignRepository(env.DB, { workspaceId });
  const first = await repository.version(page.id, page.versionId);
  expect(first?.variableSnapshot?.values.find((v) => v.key === "title")?.revision).toBe(1);
  expect(first?.document.html).toContain("{{variables.title}}");
  await variables.save({
    projectId: null,
    key: "title",
    type: "string",
    value: "Changed",
    expectedRevision: 1,
  });
  await client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  expect((await repository.version(page.id, page.versionId))?.publishedDocument?.html).toBe(
    first?.publishedDocument?.html,
  );
  const next = await client.website.updatePage({
    id: page.id,
    name: "Variables",
    slug: "variables",
    document,
    baseVersionId: page.versionId,
  });
  await client.website.publishPage({
    id: page.id,
    versionId: next.versionId,
    baseVersionId: next.versionId,
  });
  expect((await repository.version(page.id, next.versionId))?.publishedDocument?.html).toContain(
    "Changed",
  );
  expect((await repository.version(page.id, page.versionId))?.publishedDocument?.html).toBe(
    first?.publishedDocument?.html,
  );
});
it("resolves form display text, retains source refs and refuses missing references before publication", async () => {
  const { client, workspaceId, slug } = await seedWorkspaceClient(env.DB);
  const variables = new repositories.VariableRepository(env.DB, { workspaceId });
  await variables.save({
    projectId: null,
    key: "title",
    type: "string",
    value: "Welcome",
    expectedRevision: 0,
  });
  const form = await client.website.createForm({
    name: "Form",
    slug: "variables",
    status: "published",
    turnstileEnabled: false,
    definition: { fields: [{ key: "email", type: "email", label: "{{variables.title}}" }] },
    successMessage: "Thanks {{variables.title}}",
  });
  const published = await new PublicFormRepository(env.DB).findPublishedForm(slug, "variables");
  expect(published?.definition.fields?.[0]?.label).toBe("Welcome");
  expect(published?.successMessage).toBe("Thanks Welcome");
  expect(
    (await new SignupFormRepository(env.DB, { workspaceId }).listSignupForms()).find(
      (row) => row.id === form.id,
    )?.successMessage,
  ).toBe("Thanks {{variables.title}}");
  await expect(
    client.website.createForm({
      name: "Missing",
      status: "published",
      turnstileEnabled: false,
      definition: {},
      successMessage: "{{variables.missing}}",
    }),
  ).rejects.toThrow();
  const page = await client.website.createPage({
    name: "Missing LP",
    document: { ...emptyLandingPageDocument(), title: "{{variables.missing}}" },
  });
  await expect(
    client.website.publishPage({
      id: page.id,
      versionId: page.versionId,
      baseVersionId: page.versionId,
    }),
  ).rejects.toMatchObject({ code: "PAGE_INVALID" });
});

import * as variableService from "../src/projects/variable-service";
it("previews impact against the published value and excludes changes hidden by project overrides", async () => {
  expect(variableService.previewVariableImpact).toBeDefined();
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const project = await client.projects.create({
    name: "Override",
    description: "",
    color: "#123456",
  });
  const variables = new repositories.VariableRepository(env.DB, { workspaceId });
  await variables.save({
    projectId: null,
    key: "title",
    type: "string",
    value: "Global",
    expectedRevision: 0,
  });
  await variables.save({
    projectId: project.id,
    key: "title",
    type: "string",
    value: "Local",
    expectedRevision: 0,
  });
  await client.website.createForm({
    name: "Global form",
    status: "published",
    turnstileEnabled: false,
    definition: {},
    successMessage: "{{variables.title}}",
  });
  await client.website.createForm({
    name: "Local form",
    variableProjectId: project.id,
    status: "published",
    turnstileEnabled: false,
    definition: {},
    successMessage: "{{variables.title}}",
  });
  const result = await variableService.previewVariableImpact(env.DB, workspaceId, {
    projectId: null,
    key: "title",
    type: "string",
    value: "Updated",
    expectedRevision: 1,
    remove: false,
  });
  expect(result.find((row) => row.name === "Global form")).toMatchObject({
    before: "Global",
    after: "Updated",
    requiresRepublish: true,
  });
  expect(result.find((row) => row.name === "Local form")).toMatchObject({
    before: "Local",
    after: "Local",
    requiresRepublish: false,
  });
});

it("exposes typed API mutations, read capabilities, conflict refusal and scoped usage", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  const values = [
    ["title", "string", "Hello"],
    ["count", "number", 3],
    ["enabled", "boolean", false],
    ["starts", "datetime", "2026-09-08T09:00:00+09:00"],
    ["cta", "url", "https://example.com"],
  ] as const;
  for (const [key, type, value] of values)
    await client.projects.variablesSave({ projectId: null, key, type, value, expectedRevision: 0 });
  const list = await client.projects.variablesList({ projectId: null });
  expect(list.canEdit).toBe(true);
  expect(list.effective.values.map((item) => item.key).sort()).toEqual([
    "count",
    "cta",
    "enabled",
    "starts",
    "title",
  ]);
  const concurrent = await Promise.allSettled([
    client.projects.variablesSave({
      projectId: null,
      key: "count",
      type: "number",
      value: 4,
      expectedRevision: 1,
    }),
    client.projects.variablesSave({
      projectId: null,
      key: "count",
      type: "number",
      value: 5,
      expectedRevision: 1,
    }),
  ]);
  expect(concurrent.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(concurrent.find((item) => item.status === "rejected")).toMatchObject({
    reason: { code: "VARIABLE_CONFLICT" },
  });
  await expect(
    client.projects.variablesSave({
      projectId: null,
      key: "bad",
      type: "url",
      value: "javascript:alert(1)",
      expectedRevision: 0,
    }),
  ).rejects.toThrow();
  const viewer = await seedWorkspaceClient(env.DB, { role: "viewer" });
  expect((await viewer.client.projects.variablesList({ projectId: null })).canEdit).toBe(false);
  await expect(
    viewer.client.projects.variablesSave({
      projectId: null,
      key: "title",
      type: "string",
      value: "No",
      expectedRevision: 0,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await viewer.client.projects.variablesList({ projectId: null })).definitions).toEqual([]);
});

it("pins shared forms to their own Project variables, independent of embedding Project and links", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const source = await client.projects.create({
    name: "Shared form context",
    description: "",
    color: "#123456",
  });
  const destination = await client.projects.create({
    name: "LP context",
    description: "",
    color: "#123456",
  });
  const vars = new repositories.VariableRepository(env.DB, { workspaceId });
  await vars.save({
    projectId: source.id,
    key: "title",
    type: "string",
    value: "Shared form value",
    expectedRevision: 0,
  });
  await vars.save({
    projectId: destination.id,
    key: "title",
    type: "string",
    value: "LP value",
    expectedRevision: 0,
  });
  const form = await client.website.createForm({
    name: "Shared",
    variableProjectId: source.id,
    status: "draft",
    turnstileEnabled: false,
    definition: {},
    successMessage: "{{variables.title}}",
  });
  const document = {
    ...emptyLandingPageDocument(),
    variableProjectId: destination.id,
    title: "{{variables.title}}",
    html: '<h1>{{variables.title}}</h1><div data-oe-form="signup"></div>',
    forms: [
      {
        refId: "signup",
        formId: form.id,
        name: "Shared form",
        definition: { progressiveMaxFields: 3 },
        successMessage: "{{variables.title}}",
        turnstileEnabled: false,
      },
    ],
  };
  const page = await client.website.createPage({ name: "LP", document });
  await client.website.publishPage({
    id: page.id,
    versionId: page.versionId,
    baseVersionId: page.versionId,
  });
  const published = await new LandingDesignRepository(env.DB, { workspaceId }).version(
    page.id,
    page.versionId,
  );
  expect(published?.publishedDocument?.title).toBe("LP value");
  expect(published?.publishedDocument?.forms[0]?.successMessage).toBe("Shared form value");
  const pinned = await new (
    await import("@openengage/database/web")
  ).PublicLandingRepository(env.DB).pinnedForm(
    workspaceId,
    published!.formBindings[0]!.formVersionId,
  );
  expect(pinned?.successMessage).toBe("Shared form value");
  await vars.save({
    projectId: source.id,
    key: "title",
    type: "string",
    value: "Edited shared form value",
    expectedRevision: 1,
  });
  expect(
    (await new LandingDesignRepository(env.DB, { workspaceId }).version(page.id, page.versionId))
      ?.publishedDocument?.forms[0]?.successMessage,
  ).toBe("Shared form value");
});
it("refuses HTML attribute variables before sanitizer can silently erase the invalid reference", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  await expect(
    client.website.createPage({
      name: "Invalid attribute",
      document: { ...emptyLandingPageDocument(), html: '<a href="{{variables.missing}}">Link</a>' },
    }),
  ).rejects.toMatchObject({ code: "PAGE_INVALID" });
});
it("previews current draft values and exposes missing-variable diagnostics without changing publication", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  await client.projects.variablesSave({
    projectId: null,
    key: "title",
    type: "string",
    value: "Preview title",
    expectedRevision: 0,
  });
  const page = await client.website.createPage({
    name: "Preview",
    document: { ...emptyLandingPageDocument(), html: "<h1>{{variables.title}}</h1>" },
  });
  expect((await client.website.getPageDesign({ id: page.id })).previewHtml).toContain(
    "Preview title",
  );
  const missing = await client.website.createPage({
    name: "Missing preview",
    document: { ...emptyLandingPageDocument(), title: "{{variables.missing}}" },
  });
  const design = await client.website.getPageDesign({ id: missing.id });
  expect(design.variableError).toContain("Undefined variable");
  expect(design.publishedVersionId).toBeNull();
});
