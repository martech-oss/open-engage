import { env } from "cloudflare:workers";

import type { EmailSequenceProposal } from "@openengage/core/automations";
import type { WorkspaceContext } from "@openengage/core/shared";
import { createDatabase, member, user, uuidv7 } from "@openengage/database/testing";

export async function addApprover(workspace: WorkspaceContext): Promise<WorkspaceContext> {
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

export function briefDraft(ownerUserId: string, approverUserId: string) {
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

export function sequenceProposal(
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
