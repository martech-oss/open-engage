import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createDatabase,
  ProjectBriefLinkConflictError,
  ProjectResourceCommandRepository,
  SegmentRepository,
  uuidv7,
} from "@openengage/database/testing";

import {
  archiveProjectBrief,
  createProjectBrief,
  getProjectBrief,
  ProjectBriefServiceError,
  reopenProjectBrief,
  reviewProjectBrief,
  submitProjectBrief,
} from "../src/projects/project-brief-service";
import { seedWorkspaceContext } from "./factory";
import { addProjectBriefMember, projectBriefInput } from "./project-brief-test-support";

describe("project brief authorization", () => {
  it("rejects submission after an assigned member is demoted", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-demotion-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-demotion-approver", "marketer");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await env.DB.prepare(
      "UPDATE member SET role = 'viewer' WHERE organization_id = ? AND user_id = ?",
    )
      .bind(owner.workspaceId, approver.userId)
      .run();

    await expect(submitProjectBrief(createDatabase(env.DB), owner, id)).rejects.toMatchObject({
      kind: "invalid_member",
    });
    expect((await getProjectBrief(createDatabase(env.DB), owner, id)).project.status).toBe("draft");
  });

  it("revalidates an administrator membership inside privileged transitions", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-admin-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-admin-approver", "marketer");
    const administrator = await addProjectBriefMember(owner, "brief-admin-revoked", "admin");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Ready");
    const before = await getProjectBrief(createDatabase(env.DB), owner, id);
    await env.DB.prepare("DELETE FROM member WHERE organization_id = ? AND user_id = ?")
      .bind(owner.workspaceId, administrator.userId)
      .run();
    await expect(
      reopenProjectBrief(createDatabase(env.DB), administrator, id),
    ).rejects.toBeInstanceOf(ProjectBriefServiceError);
    await expect(
      archiveProjectBrief(createDatabase(env.DB), administrator, id),
    ).rejects.toBeInstanceOf(ProjectBriefServiceError);
    const after = await getProjectBrief(createDatabase(env.DB), owner, id);
    expect(after.project).toMatchObject({
      status: "approved",
      revision: 1,
      rowVersion: before.project.rowVersion,
    });
  });

  it("does not let another marketer remove an approved brief resource", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-link-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-link-approver", "marketer");
    const otherMarketer = await addProjectBriefMember(owner, "brief-link-other", "marketer");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Ready");
    const segment = await new SegmentRepository(env.DB, owner).createSegment({
      name: "Protected audience",
      slug: `protected-${id.slice(-8).toLowerCase()}`,
      kind: "static",
      membershipSource: "Approved brief",
      projectLink: { projectId: id, briefRevision: 1, addedByUserId: owner.userId },
    });
    const before = await env.DB.prepare(
      "SELECT row_version AS rowVersion FROM project_briefs WHERE workspace_id = ? AND project_id = ?",
    )
      .bind(owner.workspaceId, id)
      .first<{ rowVersion: number }>();
    await expect(
      new SegmentRepository(env.DB, otherMarketer).createSegment({
        name: "Must not impersonate an admin",
        slug: `impersonation-${id.slice(-8).toLowerCase()}`,
        kind: "static",
        membershipSource: "Invalid delegated actor",
        projectLink: {
          projectId: id,
          briefRevision: 1,
          addedByUserId: owner.userId,
        },
      }),
    ).rejects.toBeInstanceOf(ProjectBriefLinkConflictError);

    const outcome = await new ProjectResourceCommandRepository(
      createDatabase(env.DB),
      otherMarketer,
    ).removeApproved({
      projectId: id,
      resourceType: "segment",
      resourceId: segment.id,
    });
    expect(outcome).toEqual({ kind: "conflict" });
    const after = await env.DB.prepare(
      `SELECT
        (SELECT row_version FROM project_briefs WHERE workspace_id = ? AND project_id = ?) AS rowVersion,
        (SELECT COUNT(*) FROM project_items WHERE workspace_id = ? AND project_id = ? AND resource_type = 'segment' AND resource_id = ?) AS links,
        (SELECT COUNT(*) FROM audit_logs WHERE workspace_id = ? AND resource_id = ? AND action = 'project.item.remove') AS audits`,
    )
      .bind(owner.workspaceId, id, owner.workspaceId, id, segment.id, owner.workspaceId, id)
      .first<{ rowVersion: number; links: number; audits: number }>();
    expect(after).toEqual({ rowVersion: before?.rowVersion, links: 1, audits: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM segments WHERE workspace_id = ? AND slug = ?",
      )
        .bind(owner.workspaceId, `impersonation-${id.slice(-8).toLowerCase()}`)
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("reconfirms a stale manual resource link at the current approved revision", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-relink-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-relink-approver", "marketer");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Revision 1");
    const segment = await new SegmentRepository(env.DB, owner).createSegment({
      name: "Audience to reconfirm",
      slug: `reconfirm-${id.slice(-8).toLowerCase()}`,
      kind: "static",
      membershipSource: "Manual",
    });
    const repository = new ProjectResourceCommandRepository(createDatabase(env.DB), owner);
    const resource = { projectId: id, resourceType: "segment" as const, resourceId: segment.id };
    await expect(repository.addApproved(resource)).resolves.toEqual({
      kind: "done",
      changed: true,
    });
    await expect(repository.addApproved(resource)).resolves.toEqual({
      kind: "done",
      changed: false,
    });

    await reopenProjectBrief(createDatabase(env.DB), owner, id);
    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Revision 2");
    await expect(repository.addApproved(resource)).resolves.toEqual({
      kind: "done",
      changed: true,
    });
    await expect(repository.addApproved(resource)).resolves.toEqual({
      kind: "done",
      changed: false,
    });
    expect(
      await env.DB.prepare(
        `SELECT
          (SELECT brief_revision FROM project_items WHERE workspace_id = ? AND project_id = ? AND resource_type = 'segment' AND resource_id = ?) AS revision,
          (SELECT COUNT(*) FROM audit_logs WHERE workspace_id = ? AND resource_id = ? AND action = 'project.item.add') AS audits`,
      )
        .bind(owner.workspaceId, id, segment.id, owner.workspaceId, id)
        .first<{ revision: number; audits: number }>(),
    ).toEqual({ revision: 2, audits: 2 });
  });

  it("guards old-server review, metadata, item insert, and item delete races", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-rolling-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-rolling-approver", "marketer");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Revision 1");
    const linked = await new SegmentRepository(env.DB, owner).createSegment({
      name: "Rolling link",
      slug: `rolling-linked-${id.slice(-8).toLowerCase()}`,
      kind: "static",
      membershipSource: "Approved revision",
      projectLink: { projectId: id, briefRevision: 1, addedByUserId: owner.userId },
    });
    await reopenProjectBrief(createDatabase(env.DB), owner, id);

    const staleSegmentId = uuidv7();
    const now = new Date().toISOString();
    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO segments (id, workspace_id, name, slug, description, kind, membership_source, created_at, updated_at)
           VALUES (?, ?, 'Stale rolling segment', ?, '', 'static', 'Old server', ?, ?)`,
        ).bind(staleSegmentId, owner.workspaceId, `rolling-stale-${id}`, now, now),
        env.DB.prepare(
          `INSERT INTO project_items (workspace_id, project_id, resource_type, resource_id, brief_revision, added_by_user_id, created_at)
           VALUES (?, ?, 'segment', ?, 1, ?, ?)`,
        ).bind(owner.workspaceId, id, staleSegmentId, owner.userId, now),
      ]),
    ).rejects.toThrow();
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM segments WHERE id = ?")
        .bind(staleSegmentId)
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
    await expect(
      env.DB.prepare(
        "DELETE FROM project_items WHERE workspace_id = ? AND project_id = ? AND resource_type = 'segment' AND resource_id = ?",
      )
        .bind(owner.workspaceId, id, linked.id)
        .run(),
    ).rejects.toThrow();

    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Revision 2");
    await expect(
      env.DB.prepare(
        `INSERT INTO project_brief_reviews (id, workspace_id, project_id, revision, reviewer_user_id, decision, comment, created_at)
         VALUES (?, ?, ?, 2, ?, 'approved', 'Old losing review', ?)`,
      )
        .bind(uuidv7(), owner.workspaceId, id, approver.userId, now)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "UPDATE projects SET name = 'Old stale name' WHERE workspace_id = ? AND id = ?",
      )
        .bind(owner.workspaceId, id)
        .run(),
    ).rejects.toThrow();
    expect((await getProjectBrief(createDatabase(env.DB), owner, id)).project.name).toBe(
      "Trial activation",
    );
  });

  it("resolves more than one hundred links without exceeding D1 bind limits", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-large-links-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-large-links-approver", "marketer");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Ready");
    const now = new Date().toISOString();
    const inserts = Array.from({ length: 101 }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO project_items (workspace_id, project_id, resource_type, resource_id, brief_revision, added_by_user_id, created_at)
         VALUES (?, ?, 'segment', ?, 1, ?, ?)`,
      ).bind(owner.workspaceId, id, `missing-segment-${index}`, owner.userId, now),
    );
    await env.DB.batch(inserts.slice(0, 50));
    await env.DB.batch(inserts.slice(50));

    const detail = await getProjectBrief(createDatabase(env.DB), owner, id);
    expect(detail.items).toHaveLength(101);
    expect(detail.items.every((item) => item.availability === "missing")).toBe(true);
  });
});
