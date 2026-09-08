import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { defaultEmailDocumentV2 } from "@openengage/core/messaging";
import { emptyLandingPageDocument } from "@openengage/core/web";
import { ProjectCloneRepository } from "@openengage/database/projects";

import { seedMember, seedWorkspaceClient } from "./factory";
import { cloneOptions, finishClone } from "./project-clone-test-support";

it.each(["delete", "rename"] as const)(
  "guards a shared segment predicate against %s after preview",
  async (change) => {
    const f = await seedWorkspaceClient(env.DB);
    const project = await f.client.projects.create({ name: "Source" });
    const shared = await f.client.segments.create({
      name: "Shared audience",
      slug: "shared-audience",
      kind: "static",
    });
    const dynamic = await f.client.segments.create({
      name: "Dependent",
      kind: "dynamic",
      filter: { kind: "condition", field: "segment", operator: "eq", value: "shared-audience" },
    });
    await f.client.projects.addItem({
      id: project.id,
      resourceType: "segment",
      resourceId: dynamic.id,
    });
    const clone = await f.client.projects.clonePreview({ id: project.id, options: cloneOptions });
    expect(clone.sharedReferences).toContainEqual(
      expect.objectContaining({ kind: "segment", id: shared.id, name: "Shared audience" }),
    );
    if (change === "delete")
      await env.DB.prepare("DELETE FROM segments WHERE id=?").bind(shared.id).run();
    else
      await env.DB.prepare("UPDATE segments SET slug='renamed' WHERE id=?").bind(shared.id).run();
    await expect(finishClone(f, project.id, clone.id)).rejects.toThrow();
    expect((await new ProjectCloneRepository(env.DB, f).get(clone.id))?.status).toBe("failed");
    expect(
      await env.DB.prepare("SELECT id FROM projects WHERE id=?")
        .bind(clone.targetProjectId)
        .first(),
    ).toBeNull();
  },
);

it("rejects a foreign predicate reference but remaps a copied static segment without sharing it", async () => {
  const f = await seedWorkspaceClient(env.DB),
    foreign = await seedWorkspaceClient(env.DB);
  const project = await f.client.projects.create({ name: "Source" });
  await foreign.client.segments.create({ name: "Foreign", slug: "foreign", kind: "static" });
  const previous = await f.client.segments.create({
    name: "Previous",
    slug: "foreign",
    kind: "static",
  });
  const dynamic = await f.client.segments.create({
    name: "Dependent",
    kind: "dynamic",
    filter: { kind: "condition", field: "segment", operator: "eq", value: "foreign" },
  });
  await f.client.projects.addItem({
    id: project.id,
    resourceType: "segment",
    resourceId: dynamic.id,
  });
  await env.DB.prepare("DELETE FROM segments WHERE id=?").bind(previous.id).run();
  await expect(
    f.client.projects.clonePreview({ id: project.id, options: cloneOptions }),
  ).rejects.toMatchObject({ code: "PROJECT_CLONE_INVALID" });
  const local = await f.client.segments.create({ name: "Local", slug: "foreign", kind: "static" });
  await f.client.projects.addItem({
    id: project.id,
    resourceType: "segment",
    resourceId: local.id,
  });
  const clone = await f.client.projects.clonePreview({ id: project.id, options: cloneOptions });
  expect(clone.sharedReferences.filter((r) => r.kind === "segment")).toHaveLength(0);
  await finishClone(f, project.id, clone.id);
  const copied = await f.client.segments.get({
    id: clone.resources.find((r) => r.kind === "segment" && r.sourceId === dynamic.id)!.targetId,
  });
  expect(copied.filterAst).toMatchObject({
    value: clone.resources.find((r) => r.kind === "segment" && r.sourceId === local.id)!.targetSlug,
  });
});

it("uses the selected Automation publication's context instead of its discarded draft context", async () => {
  const f = await seedWorkspaceClient(env.DB);
  const project = await f.client.projects.create({ name: "Selected" });
  const unused = await f.client.projects.create({ name: "Unselected draft" });
  const graph = {
    name: "Automation",
    variableProjectId: project.id,
    nodes: [
      {
        id: "source",
        type: "source" as const,
        position: { x: 0, y: 0 },
        config: { source: "contact_created" as const },
      },
    ],
    edges: [],
  };
  const automation = await f.client.automations.create(graph);
  await f.client.automations.publish({ id: automation.id });
  await f.client.automations.saveDraft({
    ...graph,
    id: automation.id,
    variableProjectId: unused.id,
  });
  await f.client.projects.addItem({
    id: project.id,
    resourceType: "automation",
    resourceId: automation.id,
  });
  const clone = await f.client.projects.clonePreview({ id: project.id, options: cloneOptions });
  expect(clone.sharedReferences.some((r) => r.id === unused.id)).toBe(false);
  await env.DB.prepare("DELETE FROM projects WHERE id=?").bind(unused.id).run();
  await finishClone(f, project.id, clone.id);
  const targetId = clone.resources.find((r) => r.kind === "automation")!.targetId;
  const row = await env.DB.prepare("SELECT variable_project_id FROM automations WHERE id=?")
    .bind(targetId)
    .first();
  expect(row?.variable_project_id).toBe(clone.targetProjectId);
  expect((await f.client.automations.getDraft({ id: targetId })).graph.variableProjectId).toBe(
    clone.targetProjectId,
  );
});

it("guards typed predicate IDs, slugs and keys without treating literal text as references", async () => {
  const f = await seedWorkspaceClient(env.DB);
  await seedMember(env.DB, f);
  const project = await f.client.projects.create({ name: "Source" });
  const shared = await f.client.projects.create({ name: "Shared program" });
  const tag = await f.client.contacts.createTag({ name: "VIP", color: "#0f766e" });
  const topic = await f.client.consent.createTopic({ name: "News", slug: "news" });
  const category = await f.client.scoring.createCategory({ name: "Interest", slug: "interest" });
  const dynamic = await f.client.segments.create({
    name: "Typed references",
    kind: "dynamic",
    filter: {
      kind: "group",
      combinator: "and",
      children: [
        { kind: "condition", field: "tag", operator: "eq", value: tag.slug },
        { kind: "condition", field: "subscription", operator: "eq", value: "news" },
        { kind: "condition", field: "category_score", operator: "gt", key: category.id, value: 1 },
        { kind: "condition", field: "project_id", operator: "eq", value: shared.id },
        { kind: "condition", field: "owner_user_id", operator: "eq", value: f.userId },
        {
          kind: "condition",
          field: "owner_user_id",
          operator: "contains",
          value: "literal-prefix",
        },
        {
          kind: "condition",
          field: "event_resource_id",
          operator: "eq",
          value: "custom-event-literal",
        },
      ],
    },
  });
  await f.client.projects.addItem({
    id: project.id,
    resourceType: "segment",
    resourceId: dynamic.id,
  });
  const clone = await f.client.projects.clonePreview({ id: project.id, options: cloneOptions });
  expect(clone.sharedReferences.map((r) => `${r.kind}:${r.id}`).sort()).toEqual(
    [
      `project:${shared.id}`,
      `tag:${tag.id}`,
      `topic:${topic.id}`,
      `scoring_category:${category.id}`,
      `user:${f.userId}`,
    ].sort(),
  );
  await env.DB.prepare("DELETE FROM scoring_categories WHERE id=?").bind(category.id).run();
  await expect(finishClone(f, project.id, clone.id)).rejects.toThrow();
  expect(
    await env.DB.prepare("SELECT id FROM projects WHERE id=?").bind(clone.targetProjectId).first(),
  ).toBeNull();
});

it("rewrites a linked transactional Markdown destination through the frozen LP slug map", async () => {
  const f = await seedWorkspaceClient(env.DB);
  const project = await f.client.projects.create({ name: "Source" });
  const page = await f.client.website.createPage({
    name: "Offer",
    slug: "offer",
    document: emptyLandingPageDocument(),
  });
  const sourceUrl = `http://localhost:8787/p/${f.slug}/offer`;
  // Email validation requires HTTPS; preview capture accepts an explicit public origin.
  const content = {
    ...defaultEmailDocumentV2(),
    blocks: [
      {
        id: "body",
        type: "markdown" as const,
        markdown: `[Offer](${sourceUrl.replace("http:", "https:")}?source=email#join) and [External](https://external.example/offer)`,
      },
    ],
  };
  const email = await f.client.emails.createTemplate({
    name: "Transactional",
    purpose: "transactional",
    subject: "Offer",
    content,
  });
  for (const [resourceType, resourceId] of [
    ["landing_page", page.id],
    ["email_sequence", email.id],
  ] as const)
    await f.client.projects.addItem({ id: project.id, resourceType, resourceId });
  const { previewProjectClone } = await import("../src/projects/clone-service");
  const { createDatabase } = await import("@openengage/database/client");
  const clone = await previewProjectClone(
    createDatabase(env.DB),
    { workspaceId: f.workspaceId, userId: f.userId, role: "owner" },
    project.id,
    cloneOptions,
    "https://localhost:8787",
  );
  await finishClone(f, project.id, clone.id);
  const targetPage = clone.resources.find((r) => r.kind === "landing_page")!;
  const row = await env.DB.prepare("SELECT draft_content FROM email_templates WHERE id=?")
    .bind(clone.resources.find((r) => r.kind === "email_sequence")!.targetId)
    .first<{ draft_content: string }>();
  expect(JSON.parse(row!.draft_content).blocks[0].markdown).toBe(
    `[Offer](https://localhost:8787/p/${f.slug}/${targetPage.targetSlug}?source=email#join) and [External](https://external.example/offer)`,
  );
});
