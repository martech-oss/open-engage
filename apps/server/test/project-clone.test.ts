import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES } from "@openengage/core/projects";
import { emptyLandingPageDocument } from "@openengage/core/web";
import { ProjectCloneRepository } from "@openengage/database/projects";

import { seedWorkspaceClient } from "./factory";

const options = (name: string) => ({
  name,
  ownerUserId: null,
  approverUserId: null,
  reviewAt: null,
  variables: {},
});
async function finish(repository: ProjectCloneRepository, jobId: string) {
  for (let step = 0; step < 30; step++) {
    const outcome = await repository.process(jobId, 2);
    if (outcome === "completed") return;
  }
  throw new Error("Clone did not finish within its bounded manifest");
}

describe("project clone", () => {
  it("freezes published versions, remaps form/project references, isolates staging and never copies members", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const project = await client.projects.create({ name: "Original" });
    await client.projects.programSave({
      id: project.id,
      definition: PROJECT_PROGRAM_TEMPLATES.event,
      expectedRowVersion: 0,
    });
    await client.projects.programPublish({
      id: project.id,
      expectedRowVersion: 1,
      confirmed: true,
    });
    await client.projects.variablesSave({
      projectId: project.id,
      key: "title",
      type: "string",
      value: "Original title",
      expectedRevision: 0,
    });
    const form = await client.website.createForm({
      name: "Registration",
      slug: "registration",
      status: "published",
      turnstileEnabled: false,
      definition: { fields: [{ key: "email", label: "Email", type: "email" }] },
    });
    const pageDocument = {
      ...emptyLandingPageDocument("Published source"),
      html: '<main><h1>Offer</h1><div data-oe-form="register"></div></main>',
      variableProjectId: project.id,
      measurement: { projectId: project.id, primaryConversion: "form_submitted" as const },
      forms: [
        {
          refId: "register",
          formId: form.id,
          name: "Registration",
          definition: { fields: [{ key: "email", label: "Email", type: "email" as const }] },
          successMessage: "Thanks",
          turnstileEnabled: false,
        },
      ],
    };
    const page = await client.website.createPage({
      name: "Offer",
      slug: "offer",
      document: pageDocument,
    });
    await client.website.publishPage({
      id: page.id,
      versionId: page.versionId,
      baseVersionId: page.versionId,
    });
    await client.website.updatePage({
      id: page.id,
      name: "Offer",
      slug: "offer",
      document: { ...pageDocument, title: "Unpublished edits" },
      baseVersionId: page.versionId,
    });
    for (const [resourceType, resourceId] of [
      ["landing_page", page.id],
      ["form", form.id],
    ] as const)
      await client.projects.addItem({ id: project.id, resourceType, resourceId });
    const preview = await client.projects.clonePreview({
      id: project.id,
      options: { ...options("Copy"), variables: { title: "Copy title" } },
    });
    expect(
      preview.resources.filter((item) => item.kind === "form" && item.sourceId === form.id),
    ).toHaveLength(1);
    await client.projects.variablesSave({
      projectId: project.id,
      key: "title",
      type: "string",
      value: "Changed after preview",
      expectedRevision: 1,
    });
    const started = await client.projects.cloneStart({
      id: project.id,
      jobId: preview.id,
      requestKey: "clone-request",
    });
    expect(
      (
        await client.projects.cloneStart({
          id: project.id,
          jobId: preview.id,
          requestKey: "clone-request",
        })
      ).targetProjectId,
    ).toBe(started.targetProjectId);
    const repository = new ProjectCloneRepository(env.DB, { workspaceId });
    await repository.process(preview.id, 1);
    expect((await client.projects.list()).some((item) => item.id === preview.targetProjectId)).toBe(
      false,
    );
    await finish(repository, preview.id);
    const completed = await client.projects.cloneGet({ id: project.id, jobId: preview.id });
    expect(completed.status).toBe("completed");
    expect(
      (await client.projects.list()).filter((item) => item.id === preview.targetProjectId),
    ).toHaveLength(1);
    const targetPage = completed.resources.find((item) => item.kind === "landing_page")!;
    const publishedForm = (await client.website.getPageDesign({ id: page.id })).versions.find(
      (version) => version.id === page.versionId,
    )!.formBindings[0]!;
    const targetForm = completed.resources.find(
      (item) => item.kind === "form" && item.sourceId === publishedForm.formId,
    )!;
    const row = await env.DB.prepare(
      "SELECT v.document,p.status,p.published_version_id FROM landing_pages p JOIN landing_page_versions v ON v.id=p.current_version_id WHERE p.id=?",
    )
      .bind(targetPage.targetId)
      .first<{ document: string; status: string; published_version_id: string | null }>();
    expect(row?.status).toBe("draft");
    expect(row?.published_version_id).toBeNull();
    expect(JSON.parse(row!.document)).toMatchObject({
      title: "Published source",
      variableProjectId: preview.targetProjectId,
      measurement: { projectId: preview.targetProjectId },
      forms: [{ formId: targetForm.targetId }],
    });
    expect(
      (
        await client.projects.variablesList({ projectId: preview.targetProjectId })
      ).effective.values.find((item) => item.key === "title")?.value,
    ).toBe("Copy title");
    expect((await client.projects.memberList({ id: preview.targetProjectId })).total).toBe(0);
    expect(
      (await client.projects.programGet({ id: preview.targetProjectId })).program?.publishedVersion,
    ).toBeNull();
    expect(await repository.process(preview.id)).toBe("completed");
  });

  it("rolls back every resource when a shared reference disappears and retries into the same destination", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const source = await client.projects.create({ name: "Source" });
    const shared = await client.projects.create({ name: "Shared context" });
    const page = await client.website.createPage({
      name: "Page",
      document: { ...emptyLandingPageDocument(), variableProjectId: shared.id },
    });
    await client.projects.addItem({
      id: source.id,
      resourceType: "landing_page",
      resourceId: page.id,
    });
    const preview = await client.projects.clonePreview({
      id: source.id,
      options: options("Retry copy"),
    });
    expect(preview.sharedReferences).toContainEqual({
      kind: "project",
      id: shared.id,
      name: "Shared context",
    });
    await client.projects.cloneStart({
      id: source.id,
      jobId: preview.id,
      requestKey: "retry-copy",
    });
    await env.DB.prepare("DELETE FROM projects WHERE id=?").bind(shared.id).run();
    const repository = new ProjectCloneRepository(env.DB, { workspaceId });
    await expect(finish(repository, preview.id)).rejects.toThrow();
    expect((await repository.get(preview.id))?.status).toBe("failed");
    expect((await client.projects.list()).some((item) => item.id === preview.targetProjectId)).toBe(
      false,
    );
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES(?,?,?,?,?)",
    )
      .bind(shared.id, workspaceId, "Restored", now, now)
      .run();
    await client.projects.cloneRetry({ id: source.id, jobId: preview.id });
    await finish(repository, preview.id);
    expect((await repository.get(preview.id))?.targetProjectId).toBe(preview.targetProjectId);
    expect(
      (await client.projects.list()).filter((item) => item.id === preview.targetProjectId),
    ).toHaveLength(1);
  });

  it("rejects cross-workspace previews, foreign jobs and incompatible clone variable overrides", async () => {
    const a = await seedWorkspaceClient(env.DB),
      b = await seedWorkspaceClient(env.DB);
    const project = await a.client.projects.create({ name: "Private" });
    await expect(
      b.client.projects.clonePreview({ id: project.id, options: options("Foreign") }),
    ).rejects.toMatchObject({ code: "PROJECT_CLONE_NOT_FOUND" });
    await a.client.projects.variablesSave({
      projectId: project.id,
      key: "count",
      type: "number",
      value: 4,
      expectedRevision: 0,
    });
    await expect(
      a.client.projects.clonePreview({
        id: project.id,
        options: { ...options("Invalid"), variables: { count: "four" } },
      }),
    ).rejects.toMatchObject({ code: "PROJECT_CLONE_INVALID" });
    const preview = await a.client.projects.clonePreview({
      id: project.id,
      options: options("Allowed"),
    });
    await expect(
      b.client.projects.cloneGet({ id: project.id, jobId: preview.id }),
    ).rejects.toMatchObject({ code: "PROJECT_CLONE_NOT_FOUND" });
  });

  it("keeps cloned tracking links private until explicitly published", async () => {
    const { client, workspaceId, slug } = await seedWorkspaceClient(env.DB);
    const project = await client.projects.create({ name: "Campaign" });
    const redirect = await client.website.createRedirect({
      name: "Link",
      slug: "campaign-link",
      destinationUrl: "https://example.com",
    });
    await client.projects.addItem({
      id: project.id,
      resourceType: "redirect",
      resourceId: redirect.id,
    });
    const preview = await client.projects.clonePreview({
      id: project.id,
      options: options("Next campaign"),
    });
    await client.projects.cloneStart({
      id: project.id,
      jobId: preview.id,
      requestKey: "link-clone",
    });
    await finish(new ProjectCloneRepository(env.DB, { workspaceId }), preview.id);
    const link = preview.resources.find((item) => item.kind === "redirect")!;
    const url = `http://localhost:8787/r/${slug}/${link.targetSlug}`;
    expect((await exports.default.fetch(new Request(url, { redirect: "manual" }))).status).toBe(
      404,
    );
    await client.website.updateRedirect({
      id: link.targetId,
      name: "Copy link",
      slug: link.targetSlug!,
      destinationUrl: "https://example.com",
      status: "published",
    });
    expect((await exports.default.fetch(new Request(url, { redirect: "manual" }))).status).toBe(
      302,
    );
  });
});
