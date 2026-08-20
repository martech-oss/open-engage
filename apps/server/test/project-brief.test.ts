import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  AutomationRepository,
  createDatabase,
  CustomRedirectRepository,
  ProjectBriefLinkConflictError,
  projectItems,
  SegmentRepository,
} from "@openengage/database/testing";

import {
  approvedProjectBriefContext,
  addProjectBriefItem,
  completeProjectBrief,
  createProjectBrief,
  getProjectBrief,
  ProjectBriefServiceError,
  reopenProjectBrief,
  reviewProjectBrief,
  submitProjectBrief,
  updateProjectBrief,
  withdrawProjectBrief,
} from "../src/projects/project-brief-service";
import { seedWorkspaceContext } from "./factory";
import { addProjectBriefMember, projectBriefInput } from "./project-brief-test-support";

describe("project brief workflow", () => {
  it("links workspace redirects and retains archived link details", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-redirect-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-redirect-approver", "marketer");
    const foreign = await seedWorkspaceContext(env.DB, "brief-redirect-foreign", "owner");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Ready");

    const redirects = new CustomRedirectRepository(createDatabase(env.DB), owner);
    const active = await redirects.createRedirect({
      name: "Activation campaign",
      slug: `activation-${id}`,
      destinationUrl: "https://example.com/activation",
    });
    const archived = await redirects.createRedirect({
      name: "Archived campaign",
      slug: `archived-${id}`,
      destinationUrl: "https://example.com/archived",
    });
    await redirects.archiveRedirect(archived.id);
    const foreignRedirect = await new CustomRedirectRepository(
      createDatabase(env.DB),
      foreign,
    ).createRedirect({
      name: "Foreign campaign",
      slug: `foreign-${id}`,
      destinationUrl: "https://example.com/foreign",
    });

    await expect(
      addProjectBriefItem(createDatabase(env.DB), owner, {
        id,
        resourceType: "redirect",
        resourceId: active.id,
      }),
    ).resolves.toEqual({ added: true });
    expect((await getProjectBrief(createDatabase(env.DB), owner, id)).items).toEqual([
      expect.objectContaining({
        resourceType: "redirect",
        resourceId: active.id,
        name: "Activation campaign",
        status: "active",
        availability: "available",
      }),
    ]);
    await redirects.archiveRedirect(active.id);
    expect((await getProjectBrief(createDatabase(env.DB), owner, id)).items).toEqual([
      expect.objectContaining({
        resourceType: "redirect",
        resourceId: active.id,
        name: "Activation campaign",
        status: "archived",
        availability: "archived",
      }),
    ]);

    for (const resourceId of [archived.id, foreignRedirect.id, "missing-redirect"]) {
      await expect(
        addProjectBriefItem(createDatabase(env.DB), owner, {
          id,
          resourceType: "redirect",
          resourceId,
        }),
      ).rejects.toMatchObject({ kind: "resource_not_found" });
    }
  });

  it("locks, approves, links, reopens, and marks old revision resources stale", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-approver", "marketer");
    const input = projectBriefInput(owner.userId, approver.userId);
    const { id } = await createProjectBrief(createDatabase(env.DB), owner, input);

    await expect(
      updateProjectBrief(createDatabase(env.DB), approver, id, { ...input, name: "Not mine" }),
    ).rejects.toMatchObject({ kind: "forbidden_actor" });

    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await expect(
      updateProjectBrief(createDatabase(env.DB), owner, id, { ...input, name: "Locked" }),
    ).rejects.toMatchObject({ kind: "invalid_state" });
    await expect(
      reviewProjectBrief(createDatabase(env.DB), owner, id, "approved", "self approval"),
    ).rejects.toMatchObject({ kind: "forbidden_actor" });

    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Ready");
    const persisted = await env.DB.prepare(
      `SELECT
        json_extract(definition, '$.schemaVersion') AS schema_version,
        json_type(definition, '$.definition') AS nested_definition
      FROM project_briefs WHERE project_id = ?`,
    )
      .bind(id)
      .first<{ schema_version: number; nested_definition: string | null }>();
    expect(persisted).toEqual({ schema_version: 1, nested_definition: null });
    const context = await approvedProjectBriefContext(createDatabase(env.DB), owner, {
      projectId: id,
      briefRevision: 1,
    });
    expect(context).toMatchObject({ projectId: id, revision: 1, name: input.name });

    const segment = await new SegmentRepository(env.DB, owner).createSegment({
      name: "Approved audience",
      slug: `approved-${id.slice(-8).toLowerCase()}`,
      kind: "static",
      membershipSource: "Approved brief",
      projectLink: { projectId: id, briefRevision: 1, addedByUserId: owner.userId },
    });
    const automation = await new AutomationRepository(env.DB, owner).createAutomation({
      name: "Approved onboarding flow",
      description: "Created from approved brief",
      timezone: "UTC",
      graph: {
        name: "Approved onboarding flow",
        description: "Created from approved brief",
        timezone: "UTC",
        nodes: [
          {
            id: "source",
            type: "source",
            position: { x: 0, y: 0 },
            config: { source: "contact_created", reentry: "once" },
          },
        ],
        edges: [],
      },
      projectLink: { projectId: id, briefRevision: 1, addedByUserId: owner.userId },
    });
    expect((await getProjectBrief(createDatabase(env.DB), owner, id)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: "automation",
          resourceId: automation.id,
          briefRevision: 1,
          stale: false,
        }),
        expect.objectContaining({
          resourceType: "segment",
          resourceId: segment.id,
          briefRevision: 1,
          stale: false,
        }),
      ]),
    );

    await completeProjectBrief(createDatabase(env.DB), owner, id);
    await reopenProjectBrief(createDatabase(env.DB), owner, id);
    const reopened = await getProjectBrief(createDatabase(env.DB), owner, id);
    expect(reopened.project).toMatchObject({ status: "draft", revision: 2 });
    expect(reopened.items[0]).toMatchObject({ briefRevision: 1, stale: true });
    await expect(
      approvedProjectBriefContext(createDatabase(env.DB), owner, {
        projectId: id,
        briefRevision: 1,
      }),
    ).rejects.toMatchObject({ kind: "invalid_state" });
  });

  it("requires eligible members and preserves tenant isolation", async () => {
    const first = await seedWorkspaceContext(env.DB, "brief-first", "owner");
    const approver = await addProjectBriefMember(first, "brief-first-approver", "marketer");
    const second = await seedWorkspaceContext(env.DB, "brief-second", "owner");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      first,
      projectBriefInput(first.userId, approver.userId),
    );

    await expect(getProjectBrief(createDatabase(env.DB), second, id)).rejects.toMatchObject({
      kind: "not_found",
    });
    await expect(
      createProjectBrief(
        createDatabase(env.DB),
        first,
        projectBriefInput(first.userId, second.userId),
      ),
    ).rejects.toBeInstanceOf(ProjectBriefServiceError);

    await expect(
      createDatabase(env.DB).orm.insert(projectItems).values({
        workspaceId: second.workspaceId,
        projectId: id,
        resourceType: "segment",
        resourceId: "cross-workspace-resource",
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();
    await expect(
      createDatabase(env.DB).orm.insert(projectItems).values({
        workspaceId: first.workspaceId,
        projectId: id,
        resourceType: "segment",
        resourceId: "invalid-revision-resource",
        briefRevision: 0,
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });

  it("does not let a viewer create a brief for other eligible members", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-viewer-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-viewer-approver", "marketer");
    const viewer = await addProjectBriefMember(owner, "brief-viewer", "viewer");
    await expect(
      createProjectBrief(
        createDatabase(env.DB),
        viewer,
        projectBriefInput(owner.userId, approver.userId),
      ),
    ).rejects.toMatchObject({ kind: "forbidden_actor" });
    expect(
      await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM projects WHERE workspace_id = ?) AS projects,
          (SELECT COUNT(*) FROM project_briefs WHERE workspace_id = ?) AS briefs,
          (SELECT COUNT(*) FROM audit_logs WHERE workspace_id = ? AND action = 'project.brief.create') AS audits`,
      )
        .bind(owner.workspaceId, owner.workspaceId, owner.workspaceId)
        .first<{ projects: number; briefs: number; audits: number }>(),
    ).toEqual({ projects: 0, briefs: 0, audits: 0 });
  });

  it("allows only one concurrent approval and stores one immutable version", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-cas-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-cas-approver", "marketer");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, id, { expectedRowVersion: 1 });

    const approvals = await Promise.allSettled([
      reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "first", {
        expectedRowVersion: 2,
      }),
      reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "second", {
        expectedRowVersion: 2,
      }),
    ]);
    expect(approvals.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(approvals.filter((result) => result.status === "rejected")).toHaveLength(1);

    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM project_brief_reviews WHERE workspace_id = ? AND project_id = ?) AS reviews,
        (SELECT COUNT(*) FROM project_brief_versions WHERE workspace_id = ? AND project_id = ?) AS versions,
        (SELECT COUNT(*) FROM audit_logs WHERE workspace_id = ? AND resource_id = ? AND action = 'project.brief.approved') AS audits`,
    )
      .bind(owner.workspaceId, id, owner.workspaceId, id, owner.workspaceId, id)
      .first<{ reviews: number; versions: number; audits: number }>();
    expect(counts).toEqual({ reviews: 1, versions: 1, audits: 1 });
  });

  it("does not create derived resources when the approved revision was reopened", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-guard-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-guard-approver", "marketer");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, id);
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "approved", "Ready");
    await reopenProjectBrief(createDatabase(env.DB), owner, id);

    const staleLink = { projectId: id, briefRevision: 1, addedByUserId: owner.userId };
    const segmentIdHint = `stale-segment-${id.slice(-8).toLowerCase()}`;
    await expect(
      new SegmentRepository(env.DB, owner).createSegment({
        name: "Must not exist",
        slug: segmentIdHint,
        kind: "static",
        membershipSource: "Stale brief",
        projectLink: staleLink,
      }),
    ).rejects.toBeInstanceOf(ProjectBriefLinkConflictError);

    await expect(
      new AutomationRepository(env.DB, owner).createAutomation({
        name: "Must not exist",
        description: "Stale brief",
        timezone: "UTC",
        graph: {
          name: "Must not exist",
          description: "Stale brief",
          timezone: "UTC",
          nodes: [
            {
              id: "source",
              type: "source",
              position: { x: 0, y: 0 },
              config: { source: "contact_created", reentry: "once" },
            },
          ],
          edges: [],
        },
        projectLink: staleLink,
      }),
    ).rejects.toBeInstanceOf(ProjectBriefLinkConflictError);

    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM segments WHERE workspace_id = ? AND slug = ?) AS segments,
        (SELECT COUNT(*) FROM automations WHERE workspace_id = ? AND name = 'Must not exist') AS automations,
        (SELECT COUNT(*) FROM project_items WHERE workspace_id = ? AND project_id = ?) AS links,
        (SELECT COUNT(*) FROM audit_logs WHERE workspace_id = ? AND resource_id = ? AND action = 'project.item.add') AS link_audits`,
    )
      .bind(
        owner.workspaceId,
        segmentIdHint,
        owner.workspaceId,
        owner.workspaceId,
        id,
        owner.workspaceId,
        id,
      )
      .first<{ segments: number; automations: number; links: number; link_audits: number }>();
    expect(counts).toEqual({ segments: 0, automations: 0, links: 0, link_audits: 0 });
  });

  it("supports withdrawal and rejection without creating approval snapshots", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-return-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-return-approver", "marketer");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, id, { expectedRowVersion: 1 });
    await withdrawProjectBrief(createDatabase(env.DB), owner, id, "Needs another edit", {
      expectedRowVersion: 2,
    });
    expect((await getProjectBrief(createDatabase(env.DB), owner, id)).project).toMatchObject({
      status: "draft",
      rowVersion: 3,
    });

    await submitProjectBrief(createDatabase(env.DB), owner, id, { expectedRowVersion: 3 });
    await reviewProjectBrief(createDatabase(env.DB), approver, id, "rejected", "Fix the KPI", {
      expectedRowVersion: 4,
    });
    const returned = await getProjectBrief(createDatabase(env.DB), owner, id);
    expect(returned.project).toMatchObject({ status: "draft", rowVersion: 5 });
    expect(returned.reviews).toEqual([
      expect.objectContaining({ decision: "rejected", comment: "Fix the KPI" }),
    ]);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_brief_versions WHERE workspace_id = ? AND project_id = ?",
      )
        .bind(owner.workspaceId, id)
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("keeps old-server status writes compatible with row versions and snapshots", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-compat-owner", "owner");
    const approver = await addProjectBriefMember(owner, "brief-compat-approver", "marketer");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      projectBriefInput(owner.userId, approver.userId),
    );
    const now = new Date().toISOString();

    await env.DB.prepare(
      "UPDATE project_briefs SET status = 'pending_approval', submitted_at = ?, updated_at = ? WHERE project_id = ?",
    )
      .bind(now, now, id)
      .run();
    await env.DB.prepare(
      "UPDATE project_briefs SET status = 'approved', approved_at = ?, approved_by_user_id = ?, updated_at = ? WHERE project_id = ?",
    )
      .bind(now, approver.userId, now, id)
      .run();
    expect(
      await env.DB.prepare(
        "SELECT row_version AS rowVersion, status FROM project_briefs WHERE project_id = ?",
      )
        .bind(id)
        .first<{ rowVersion: number; status: string }>(),
    ).toEqual({ rowVersion: 3, status: "approved" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_brief_versions WHERE workspace_id = ? AND project_id = ? AND revision = 1",
      )
        .bind(owner.workspaceId, id)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });

    await env.DB.prepare(
      "UPDATE project_briefs SET status = 'draft', revision = revision + 1, approved_at = NULL, approved_by_user_id = NULL, updated_at = ? WHERE project_id = ?",
    )
      .bind(now, id)
      .run();
    expect(
      await env.DB.prepare(
        "SELECT row_version AS rowVersion, revision, status FROM project_briefs WHERE project_id = ?",
      )
        .bind(id)
        .first<{ rowVersion: number; revision: number; status: string }>(),
    ).toEqual({ rowVersion: 4, revision: 2, status: "draft" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_brief_versions WHERE workspace_id = ? AND project_id = ?",
      )
        .bind(owner.workspaceId, id)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });

    await expect(
      env.DB.prepare("UPDATE project_briefs SET row_version = 1 WHERE project_id = ?")
        .bind(id)
        .run(),
    ).rejects.toThrow();
    expect(
      await env.DB.prepare(
        "SELECT row_version AS rowVersion FROM project_briefs WHERE project_id = ?",
      )
        .bind(id)
        .first<{ rowVersion: number }>(),
    ).toEqual({ rowVersion: 4 });
  });
});
