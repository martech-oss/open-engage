import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { EmailSequenceProposal } from "@openengage/core/automations";
import type { WorkspaceContext } from "@openengage/core/shared";
import {
  createDatabase,
  EmailSequenceDraftRepository,
  member,
  ProjectBriefLinkConflictError,
  user,
  uuidv7,
} from "@openengage/database";

import {
  createProjectBrief,
  reopenProjectBrief,
  reviewProjectBrief,
  submitProjectBrief,
} from "../src/web/project-brief-service";
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

    await expect(client.automations.applySequence(proposal)).rejects.toThrow();
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

    await expect(second.client.automations.applySequence(proposal)).rejects.toThrow();
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
    const link = {
      projectId: brief.id,
      briefRevision: 1,
      addedByUserId: owner.userId,
    };
    const repository = new EmailSequenceDraftRepository(env.DB, owner);

    const first = await repository.apply(proposal, link);
    await env.DB.prepare(
      "DELETE FROM project_items WHERE workspace_id = ? AND project_id = ? AND resource_type = 'email' AND resource_id = ?",
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

async function addApprover(workspace: WorkspaceContext): Promise<WorkspaceContext> {
  const userId = uuidv7();
  const now = new Date();
  const database = createDatabase(env.DB);
  await database.orm.batch([
    database.orm.insert(user).values({
      id: userId,
      name: "Sequence approver",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }),
    database.orm.insert(member).values({
      id: uuidv7(),
      organizationId: workspace.workspaceId,
      userId,
      role: "marketer",
      createdAt: now,
    }),
  ]);
  return { workspaceId: workspace.workspaceId, userId, role: "marketer" };
}

function briefDraft(ownerUserId: string, approverUserId: string) {
  return {
    name: "Sequence campaign",
    description: "Guarded sequence",
    color: "#7c3aed",
    ownerUserId,
    approverUserId,
    primaryMotion: "onboarding" as const,
    reviewAt: new Date(Date.now() + 86_400_000).toISOString(),
    definition: {
      outcome: "Activation",
      audience: "New contacts",
      lifecycleMoment: "After signup",
      confidence: "medium" as const,
      entryTrigger: "contact_created",
      eligibility: ["New contact"],
      exclusions: ["Suppressed"],
      actions: ["Create email drafts"],
      exitCondition: "activated",
      failureBehavior: "Manual review",
      consentRequirement: "Applicable consent",
      suppressionRules: "Global suppression",
      frequencyPolicy: "Two per week",
      requiredData: ["contact.email"],
      requiredEvents: ["activated"],
      requiredContent: ["Onboarding email"],
      dependenciesAndApprovals: ["Owner approval"],
      deliveryHorizon: "One week",
      measurement: {
        outcomeMetric: { name: "Activation", proof: "activated event" },
        earlySignal: { name: "Started", proof: "started event" },
        baseline: { kind: "unknown" as const, discoveryTask: "Measure baseline" },
        successThreshold: "Increase by 5%",
      },
      immediateNextSteps: ["Verify events"],
      notIncluded: ["Delivery"],
      assumptions: ["Events work"],
      followUpExperiment: null,
    },
  };
}

function sequenceProposal(
  prefix: string,
  options?: {
    purpose?: "transactional" | "marketing";
    topicId?: string;
    segmentId?: string;
    emailCount?: number;
  },
): EmailSequenceProposal {
  const purpose = options?.purpose ?? "transactional";
  const topicId = options?.topicId ?? null;
  const templateIds = Array.from(
    { length: options?.emailCount ?? 2 },
    (_, index) => `${prefix}-template-${index + 1}`,
  );
  const source = options?.segmentId
    ? {
        id: "source",
        type: "source" as const,
        position: { x: 0, y: 0 },
        config: {
          source: "segment_joined" as const,
          segmentId: options.segmentId,
          reentry: "once" as const,
        },
      }
    : {
        id: "source",
        type: "source" as const,
        position: { x: 0, y: 0 },
        config: { source: "contact_created" as const, reentry: "once" as const },
      };
  const emails = templateIds.map((templateId, index) => ({
    emailRef: `email_${index + 1}`,
    templateId,
    name: `Sequence email ${index + 1}`,
    purpose,
    purposeDescription: purpose === "marketing" ? "Lifecycle promotion" : "Service onboarding",
    subjectOptions: [`Subject ${index + 1}A`, `Subject ${index + 1}B`],
    selectedSubject: `Subject ${index + 1}A`,
    content: {
      schemaVersion: 2 as const,
      previewText: `Preview ${index + 1}`,
      theme: {
        backgroundColor: "#f4f5f7",
        surfaceColor: "#ffffff",
        textColor: "#171717",
        mutedTextColor: "#64748b",
        accentColor: "#171717",
        fontFamily: "sans" as const,
        width: 600,
      },
      blocks: [{ id: `body-${index}`, type: "markdown" as const, markdown: "Hello." }],
    },
    cta: null,
    timing: index === 0 ? "Immediately" : "One day later",
    recipientCondition: "Active contact",
    skipCondition: "Goal reached",
    variables: [],
    topicId,
    classificationReason: purpose === "marketing" ? "Promotional content" : "Operational content",
  }));
  return {
    proposalId: `${prefix}-proposal`,
    automationId: `${prefix}-automation`,
    summary: "Two-email lifecycle sequence",
    overview: {
      name: "Lifecycle sequence",
      type: "onboarding",
      outcome: "Complete setup",
      audience: "New contacts",
      entry: options?.segmentId ? "Join target segment" : "Contact created",
      conversionExit: "Setup completed",
      cadence: "Immediate and one day later",
      reentry: "once",
      consent: purpose === "marketing" ? "Selected subscription topic" : "Service relationship",
      suppression: "Global suppression and archived contacts",
    },
    emails,
    definition: {
      name: "Lifecycle sequence",
      description: "Two-email lifecycle sequence",
      timezone: "UTC",
      metadata: {
        origin: "email_sequence",
        sequenceType: "onboarding",
        outcome: "Complete setup",
        primaryMetric: "Setup completed",
        earlySignal: "Email clicked",
      },
      nodes: [
        source,
        {
          id: "email-1",
          type: "action",
          position: { x: 200, y: 0 },
          config: {
            action: "send_email",
            templateId: templateIds[0]!,
            ...(topicId ? { topicId } : {}),
          },
        },
        {
          id: "delay",
          type: "delay",
          position: { x: 400, y: 0 },
          config: { mode: "relative", minutes: 1_440 },
        },
        {
          id: "email-2",
          type: "action",
          position: { x: 600, y: 0 },
          config: {
            action: "send_email",
            templateId: templateIds[1]!,
            ...(topicId ? { topicId } : {}),
          },
        },
      ],
      edges: [
        { id: "source-email", source: "source", target: "email-1", branch: "next" },
        { id: "email-delay", source: "email-1", target: "delay", branch: "next" },
        { id: "delay-email", source: "delay", target: "email-2", branch: "next" },
      ],
    },
    capabilityState:
      purpose === "marketing" ? "delivery-capability-blocked" : "transactional-compatible",
    measurement: {
      primaryOutcome: "Setup completed",
      earlySignal: "Email clicked",
      baseline: "unknown",
      target: "unknown",
      firstMeasurementWindow: "First 30 days",
      events: ["email_clicked", "setup_completed"],
    },
    assumptions: [],
    warnings: [],
  };
}
