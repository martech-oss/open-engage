import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { createSessionFixtureClient, seedMember, seedWorkspaceClient } from "./factory";
import { addProjectBriefMember, projectBriefInput } from "./project-brief-test-support";
import { cloneOptions, finishClone } from "./project-clone-test-support";

it("copies only active variables and resolves overrides past deleted local and Workspace definitions", async () => {
  const f = await seedWorkspaceClient(env.DB);
  const project = await f.client.projects.create({ name: "Variables" });
  for (const [projectId, key, type, value] of [
    [project.id, "deleted_local", "string", "old"],
    [null, "deleted_workspace", "string", "old"],
    [null, "fallback", "number", 3],
    [project.id, "fallback", "number", 99],
    [project.id, "revived", "string", "old"],
  ] as const) {
    await f.client.projects.variablesSave({ projectId, key, type, value, expectedRevision: 0 });
    if (!(key === "fallback" && projectId === null))
      await f.client.projects.variablesDelete({ projectId, key, expectedRevision: 1 });
  }
  const revived = await f.client.projects.variablesSave({
    projectId: project.id,
    key: "revived",
    type: "string",
    value: "active",
    expectedRevision: 0,
  });
  expect(revived.revision).toBe(3);
  for (const key of ["deleted_local", "deleted_workspace"])
    await expect(
      f.client.projects.clonePreview({
        id: project.id,
        options: { ...cloneOptions, variables: { [key]: "new" } },
      }),
    ).rejects.toMatchObject({ code: "PROJECT_CLONE_INVALID" });
  const clone = await f.client.projects.clonePreview({
    id: project.id,
    options: { ...cloneOptions, variables: { fallback: 7 } },
  });
  expect(
    clone.resources
      .filter((r) => r.kind === "variable")
      .map((r) => r.name)
      .sort(),
  ).toEqual(["fallback", "revived"]);
  await finishClone(f, project.id, clone.id);
  const rows = await env.DB.prepare(
    "SELECT key,type,value,revision,deleted_at FROM project_variables WHERE project_id=? ORDER BY key",
  )
    .bind(clone.targetProjectId)
    .all();
  expect(rows.results).toEqual([
    { key: "fallback", type: "number", value: "7", revision: 1, deleted_at: null },
    { key: "revived", type: "string", value: '"active"', revision: 1, deleted_at: null },
  ]);
  const source = await env.DB.prepare("SELECT revision FROM project_variables WHERE id=?")
    .bind(revived.id)
    .first();
  expect(source?.revision).toBe(3);
});

it("atomically creates draft brief links without copying approval history or bypassing later link guards", async () => {
  const f = await seedWorkspaceClient(env.DB);
  await seedMember(env.DB, f);
  const owner = { workspaceId: f.workspaceId, userId: f.userId, role: "owner" as const };
  const approver = await addProjectBriefMember(owner, "clone-approver", "marketer");
  const { client: reviewer } = await createSessionFixtureClient(env.DB, approver);
  const input = projectBriefInput(owner.userId, approver.userId);
  const source = await f.client.projects.briefCreate(input);
  await f.client.projects.briefSubmit({ id: source.id });
  await reviewer.projects.briefApprove({ id: source.id, comment: "Approved source" });
  const form = await f.client.website.createForm({
    name: "Approved form",
    slug: "approved-form",
    status: "draft",
    definition: { fields: [{ key: "email", label: "Email", type: "email" }] },
  });
  await f.client.projects.briefAddItem({
    id: source.id,
    resourceType: "form",
    resourceId: form.id,
    expectedRowVersion: (await f.client.projects.briefGet({ id: source.id })).rowVersion,
  });
  const clone = await f.client.projects.clonePreview({
    id: source.id,
    options: {
      ...cloneOptions,
      ownerUserId: owner.userId,
      approverUserId: approver.userId,
      reviewAt: input.reviewAt,
    },
  });
  await finishClone(f, source.id, clone.id);
  const target = await f.client.projects.briefGet({ id: clone.targetProjectId });
  expect(target.project).toMatchObject({ status: "draft", revision: 1 });
  expect(target.approvedAt).toBeNull();
  expect(target.reviews).toHaveLength(0);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS count FROM project_brief_versions WHERE project_id=?")
      .bind(clone.targetProjectId)
      .first(),
  ).toEqual({ count: 0 });
  const copied = clone.resources.find((r) => r.kind === "form")!;
  expect(
    await env.DB.prepare(
      "SELECT brief_revision FROM project_items WHERE project_id=? AND resource_id=?",
    )
      .bind(clone.targetProjectId, copied.targetId)
      .first(),
  ).toEqual({ brief_revision: null });
  // The migration's normal approval guard still applies once the atomic setup is visible.
  await expect(
    env.DB.prepare(
      "INSERT INTO project_items(workspace_id,project_id,resource_type,resource_id,brief_revision,added_by_user_id,created_at) VALUES(?,?,'form',?,NULL,?,?)",
    )
      .bind(f.workspaceId, clone.targetProjectId, form.id, owner.userId, new Date().toISOString())
      .run(),
  ).rejects.toThrow("brief resource link no longer matches an approved revision");
  expect((await f.client.projects.briefGet({ id: source.id })).project.status).toBe("approved");
  expect((await f.client.projects.briefGet({ id: source.id })).reviews).toHaveLength(1);
});
