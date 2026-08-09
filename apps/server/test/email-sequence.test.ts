import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { EmailSequenceProposal } from "@openengage/core/automations";

import { seedWorkspaceClient } from "./factory";

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
    const draft = await client.automations.getDraft({ id: proposal.automationId });
    expect(draft.publishability).toMatchObject({
      publishable: false,
      capabilityState: "transactional-compatible",
    });
    expect(draft.publishability.templates.every((template) => !template.published)).toBe(true);
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
});

function sequenceProposal(
  prefix: string,
  options?: {
    purpose?: "transactional" | "marketing";
    topicId?: string;
    segmentId?: string;
  },
): EmailSequenceProposal {
  const purpose = options?.purpose ?? "transactional";
  const topicId = options?.topicId ?? null;
  const templateIds = [`${prefix}-template-1`, `${prefix}-template-2`];
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
