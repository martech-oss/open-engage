import { describe, expect, it } from "vitest";

import {
  capabilityForSequence,
  emailSequenceProposalSchema,
  validateEmailSequenceProposal,
} from "./email-sequence.js";

const document = {
  schemaVersion: 2 as const,
  previewText: "次のステップをご案内します",
  theme: {
    backgroundColor: "#f4f5f7",
    surfaceColor: "#ffffff",
    textColor: "#171717",
    mutedTextColor: "#64748b",
    accentColor: "#171717",
    fontFamily: "sans" as const,
    width: 600,
  },
  blocks: [{ id: "body", type: "markdown" as const, markdown: "こんにちは。" }],
};

function proposal() {
  const emails = ["welcome", "follow_up"].map((emailRef, index) => ({
    emailRef,
    templateId: `template-${index + 1}`,
    name: index === 0 ? "Welcome" : "Follow up",
    purpose: "transactional" as const,
    purposeDescription: "Active service onboarding",
    subjectOptions: ["はじめましょう", "次のステップです"],
    selectedSubject: "はじめましょう",
    content: { ...document, blocks: [{ ...document.blocks[0]!, id: `body-${index}` }] },
    cta: null,
    timing: index === 0 ? "Immediately" : "After one day",
    recipientCondition: "Active contact",
    skipCondition: "Conversion completed",
    variables: [],
    topicId: null,
    classificationReason: "Operational onboarding",
  }));
  return {
    proposalId: "proposal-1",
    automationId: "automation-1",
    summary: "Two-email onboarding",
    overview: {
      name: "Trial onboarding",
      type: "onboarding" as const,
      outcome: "Publish the first campaign",
      audience: "New trial users",
      entry: "Contact created",
      conversionExit: "First campaign published",
      cadence: "Immediate, then one day",
      reentry: "once" as const,
      consent: "Active service relationship",
      suppression: "Global suppression and archived contacts",
    },
    emails,
    definition: {
      name: "Trial onboarding",
      description: "Two-email onboarding",
      timezone: "UTC",
      metadata: {
        origin: "email_sequence" as const,
        sequenceType: "onboarding" as const,
        outcome: "Publish the first campaign",
        primaryMetric: "First campaign published",
        earlySignal: "First email clicked",
      },
      nodes: [
        {
          id: "source",
          type: "source" as const,
          position: { x: 0, y: 0 },
          config: { source: "contact_created" as const, reentry: "once" as const },
        },
        {
          id: "email-1",
          type: "action" as const,
          position: { x: 200, y: 0 },
          config: { action: "send_email" as const, templateId: "template-1" },
        },
        {
          id: "delay",
          type: "delay" as const,
          position: { x: 400, y: 0 },
          config: { mode: "relative" as const, minutes: 1_440 },
        },
        {
          id: "email-2",
          type: "action" as const,
          position: { x: 600, y: 0 },
          config: { action: "send_email" as const, templateId: "template-2" },
        },
      ],
      edges: [
        { id: "e1", source: "source", target: "email-1", branch: "next" as const },
        { id: "e2", source: "email-1", target: "delay", branch: "next" as const },
        { id: "e3", source: "delay", target: "email-2", branch: "next" as const },
      ],
    },
    capabilityState: "transactional-compatible" as const,
    measurement: {
      primaryOutcome: "First campaign published",
      earlySignal: "First email clicked",
      baseline: "unknown",
      target: "unknown",
      firstMeasurementWindow: "First 30 days",
      events: ["email_clicked", "campaign_published"],
    },
    assumptions: [],
    warnings: [],
  };
}

describe("email sequence proposal", () => {
  it("accepts a consistent 2-email bundle", () => {
    const parsed = emailSequenceProposalSchema.parse(proposal());
    expect(validateEmailSequenceProposal(parsed)).toEqual([]);
  });

  it("rejects sequence lengths outside 2 to 8", () => {
    const value = proposal();
    expect(
      emailSequenceProposalSchema.safeParse({ ...value, emails: value.emails.slice(0, 1) }).success,
    ).toBe(false);
    expect(
      emailSequenceProposalSchema.safeParse({
        ...value,
        emails: Array.from({ length: 9 }, (_, index) => ({
          ...value.emails[0]!,
          emailRef: `email_${index}`,
          templateId: `template-${index}`,
        })),
      }).success,
    ).toBe(false);
  });

  it("detects a template reference outside the bundle", () => {
    const value = emailSequenceProposalSchema.parse(proposal());
    const emailNode = value.definition.nodes.find(
      (node) => node.type === "action" && node.config.action === "send_email",
    );
    if (!emailNode || emailNode.type !== "action" || emailNode.config.action !== "send_email") {
      throw new Error("fixture email node missing");
    }
    emailNode.config.templateId = "outside-template";
    expect(validateEmailSequenceProposal(value).map((issue) => issue.code)).toContain(
      "template_reference",
    );
  });

  it("derives marketing capability from any marketing message", () => {
    expect(capabilityForSequence([{ purpose: "transactional" }, { purpose: "marketing" }])).toBe(
      "delivery-capability-blocked",
    );
  });
});
