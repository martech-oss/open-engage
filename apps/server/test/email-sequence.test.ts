import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createDatabase,
  automations,
  automationVersions,
  EmailSequenceDraftRepository,
  ProjectBriefLinkConflictError,
} from "@openengage/database/testing";

import {
  createProjectBrief,
  reopenProjectBrief,
  reviewProjectBrief,
  submitProjectBrief,
} from "../src/projects/project-brief-service";
import { addApprover, briefDraft, sequenceProposal } from "./email-sequence-test-support";
import { seedWorkspaceClient, seedWorkspaceContext } from "./factory";

describe("Email sequence drafts", () => {
  it("atomically creates an idempotent template and automation bundle", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const proposal = sequenceProposal(`transactional-${workspaceId}`);

    const created = await client.automations.applySequence(proposal);
    expect(created).toMatchObject({
      automationId: proposal.automationId,
      capabilityState: "transactional-compatible",
    });
    expect(created.templates).toHaveLength(2);

    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM email_templates WHERE workspace_id = ?) AS templates,
        (SELECT COUNT(*) FROM automations WHERE workspace_id = ? AND id = ?) AS automations`,
    )
      .bind(workspaceId, workspaceId, proposal.automationId)
      .first<{ templates: number; automations: number }>();
    expect(counts).toEqual({ templates: 2, automations: 1 });

    const retried = await client.automations.applySequence(proposal);
    expect(retried).toEqual(created);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE workspace_id = ? AND action = 'email_sequence.create' AND resource_id = ?",
      )
        .bind(workspaceId, proposal.automationId)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
    const draft = await client.automations.getDraft({ id: proposal.automationId });
    expect(draft.publishability).toMatchObject({
      publishable: false,
      capabilityState: "transactional-compatible",
    });
    expect(draft.publishability.templates.every((template) => !template.published)).toBe(true);
  });

  it("converges concurrent identical first applies to one draft bundle", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "sequence-race-owner", "owner");
    const proposal = sequenceProposal(`race-${workspace.workspaceId}`);
    const firstRepository = new EmailSequenceDraftRepository(env.DB, workspace);
    const secondRepository = new EmailSequenceDraftRepository(env.DB, workspace);

    const [first, second] = await Promise.all([
      firstRepository.apply(proposal),
      secondRepository.apply(proposal),
    ]);

    expect(second).toEqual(first);
    expect(
      await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM email_templates WHERE workspace_id = ? AND id IN (?, ?)) AS templates,
          (SELECT COUNT(*) FROM automations WHERE workspace_id = ? AND id = ?) AS automations,
          (SELECT COUNT(*) FROM automation_versions WHERE workspace_id = ? AND automation_id = ?) AS versions`,
      )
        .bind(
          workspace.workspaceId,
          proposal.emails[0]!.templateId,
          proposal.emails[1]!.templateId,
          workspace.workspaceId,
          proposal.automationId,
          workspace.workspaceId,
          proposal.automationId,
        )
        .first<{ templates: number; automations: number; versions: number }>(),
    ).toEqual({ templates: 2, automations: 1, versions: 1 });
  });

  it("creates marketing drafts but keeps their automation blocked", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const topic = await client.consent.createTopic({
      name: "Product education",
      slug: `education-${workspaceId.slice(-8).toLowerCase()}`,
      description: "Lifecycle marketing",
      isDefault: false,
    });
    const proposal = sequenceProposal(`marketing-${workspaceId}`, {
      purpose: "marketing",
      topicId: topic.id,
    });
    const created = await client.automations.applySequence(proposal);
    expect(created.capabilityState).toBe("delivery-capability-blocked");

    const draft = await client.automations.getDraft({ id: proposal.automationId });
    expect(draft.publishability.publishable).toBe(false);
    expect(draft.publishability.capabilityState).toBe("delivery-capability-blocked");
    expect(draft.publishability.issues.join(" ")).toContain("Marketing");
    await expect(client.automations.publish({ id: proposal.automationId })).rejects.toThrow();
  });

  it("rejects reapplying a bundle after one of its templates was published", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const proposal = sequenceProposal(`published-${workspaceId}`);
    await client.automations.applySequence(proposal);
    await client.emails.publishTemplate({ id: proposal.emails[0]!.templateId });

    await expect(client.automations.applySequence(proposal)).rejects.toMatchObject({
      code: "SEQUENCE_CONFLICT",
      status: 409,
    });
  });

  it("rejects a cross-workspace source without leaving partial drafts", async () => {
    const first = await seedWorkspaceClient(env.DB);
    const second = await seedWorkspaceClient(env.DB);
    const segment = await first.client.segments.create({
      name: "First workspace audience",
      slug: `first-${first.workspaceId.slice(-8).toLowerCase()}`,
      description: "",
      kind: "static",
      membershipSource: "Test",
    });
    const proposal = sequenceProposal(`cross-${second.workspaceId}`, {
      segmentId: segment.id,
    });

    await expect(second.client.automations.applySequence(proposal)).rejects.toMatchObject({
      code: "INVALID_SEQUENCE",
      status: 422,
    });
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM email_templates WHERE workspace_id = ? AND id IN (?, ?)) AS templates,
        (SELECT COUNT(*) FROM automations WHERE workspace_id = ? AND id = ?) AS automations`,
    )
      .bind(
        second.workspaceId,
        proposal.emails[0]!.templateId,
        proposal.emails[1]!.templateId,
        second.workspaceId,
        proposal.automationId,
      )
      .first<{ templates: number; automations: number }>();
    expect(counts).toEqual({ templates: 0, automations: 0 });
  });

  it("does not create a sequence bundle from a reopened brief revision", async () => {
    const owner = await seedWorkspaceContext(env.DB, "sequence-guard-owner", "owner");
    const approver = await addApprover(owner);
    const brief = await createProjectBrief(createDatabase(env.DB), owner, {
      ...briefDraft(owner.userId, approver.userId),
    });
    await submitProjectBrief(createDatabase(env.DB), owner, brief.id);
    await reviewProjectBrief(createDatabase(env.DB), approver, brief.id, "approved", "Ready");
    await reopenProjectBrief(createDatabase(env.DB), owner, brief.id);
    const proposal = sequenceProposal(`stale-${owner.workspaceId}`);

    await expect(
      new EmailSequenceDraftRepository(env.DB, owner).apply(proposal, {
        projectId: brief.id,
        briefRevision: 1,
        addedByUserId: owner.userId,
      }),
    ).rejects.toBeInstanceOf(ProjectBriefLinkConflictError);
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM email_templates WHERE workspace_id = ? AND id IN (?, ?)) AS templates,
        (SELECT COUNT(*) FROM automations WHERE workspace_id = ? AND id = ?) AS automations,
        (SELECT COUNT(*) FROM project_items WHERE workspace_id = ? AND project_id = ?) AS links`,
    )
      .bind(
        owner.workspaceId,
        proposal.emails[0]!.templateId,
        proposal.emails[1]!.templateId,
        owner.workspaceId,
        proposal.automationId,
        owner.workspaceId,
        brief.id,
      )
      .first<{ templates: number; automations: number; links: number }>();
    expect(counts).toEqual({ templates: 0, automations: 0, links: 0 });
  });

  it("atomically links every sequence draft to one approved revision", async () => {
    const owner = await seedWorkspaceContext(env.DB, "sequence-link-owner", "owner");
    const approver = await addApprover(owner);
    const brief = await createProjectBrief(
      createDatabase(env.DB),
      owner,
      briefDraft(owner.userId, approver.userId),
    );
    await submitProjectBrief(createDatabase(env.DB), owner, brief.id);
    await reviewProjectBrief(createDatabase(env.DB), approver, brief.id, "approved", "Ready");
    const proposal = sequenceProposal(`linked-${owner.workspaceId}`, { emailCount: 8 });
    proposal.definition.variableProjectId = brief.id;
    const link = {
      projectId: brief.id,
      briefRevision: 1,
      addedByUserId: owner.userId,
    };
    const repository = new EmailSequenceDraftRepository(env.DB, owner);

    const first = await repository.apply(proposal, link);
    const database = createDatabase(env.DB);
    expect(
      await database.orm
        .select({ variableProjectId: automations.variableProjectId })
        .from(automations)
        .where(eq(automations.id, proposal.automationId))
        .get(),
    ).toEqual({ variableProjectId: brief.id });
    expect(
      await database.orm
        .select({
          status: automationVersions.status,
          resolvedGraph: automationVersions.resolvedGraph,
          dependencies: automationVersions.dependencies,
          variableSnapshot: automationVersions.variableSnapshot,
        })
        .from(automationVersions)
        .where(eq(automationVersions.id, first.draftVersionId))
        .get(),
    ).toEqual({ status: "draft", resolvedGraph: null, dependencies: "{}", variableSnapshot: null });
    await env.DB.prepare(
      "DELETE FROM project_items WHERE workspace_id = ? AND project_id = ? AND resource_type = 'email_sequence' AND resource_id = ?",
    )
      .bind(owner.workspaceId, brief.id, proposal.emails[1]!.templateId)
      .run();
    const second = await repository.apply(proposal, link);
    expect(second).toEqual(first);
    expect(await repository.apply(proposal, link)).toEqual(first);
    await reopenProjectBrief(createDatabase(env.DB), owner, brief.id);
    await submitProjectBrief(createDatabase(env.DB), owner, brief.id);
    await reviewProjectBrief(createDatabase(env.DB), approver, brief.id, "approved", "Revision 2");
    expect(
      await repository.apply(proposal, {
        projectId: brief.id,
        briefRevision: 2,
        addedByUserId: owner.userId,
      }),
    ).toEqual(first);
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM email_templates WHERE workspace_id = ?) AS templates,
        (SELECT COUNT(*) FROM automations WHERE workspace_id = ? AND id = ?) AS automations,
        (SELECT COUNT(*) FROM project_items WHERE workspace_id = ? AND project_id = ?) AS links,
        (SELECT MIN(brief_revision) FROM project_items WHERE workspace_id = ? AND project_id = ?) AS minRevision,
        (SELECT MAX(brief_revision) FROM project_items WHERE workspace_id = ? AND project_id = ?) AS maxRevision,
        (SELECT COUNT(*) FROM audit_logs WHERE workspace_id = ? AND resource_id = ? AND action = 'project.item.add') AS audits`,
    )
      .bind(
        owner.workspaceId,
        owner.workspaceId,
        proposal.automationId,
        owner.workspaceId,
        brief.id,
        owner.workspaceId,
        brief.id,
        owner.workspaceId,
        brief.id,
        owner.workspaceId,
        brief.id,
      )
      .first<{
        templates: number;
        automations: number;
        links: number;
        minRevision: number;
        maxRevision: number;
        audits: number;
      }>();
    expect(counts).toEqual({
      templates: 8,
      automations: 1,
      links: 9,
      minRevision: 2,
      maxRevision: 2,
      audits: 3,
    });
  });
});
