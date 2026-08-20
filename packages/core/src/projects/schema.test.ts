import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKETING_CAPABILITY_SNAPSHOT,
  PROJECT_RESOURCE_TYPES,
  PROJECT_BRIEF_TRANSITIONS,
  approvedMarketingBriefContextSchema,
  canProjectBriefTransition,
  marketingAutomationBriefDefinitionSchema,
  marketingCapabilitySnapshotSchema,
  projectBriefDraftInputSchema,
  projectBriefDocumentSchema,
  projectLinkedResourceSchema,
  projectBriefReferenceSchema,
  resolveProjectBriefAllowedActions,
} from "./schema.js";

function definition() {
  return {
    outcome: "Increase activation",
    audience: "New trial contacts",
    lifecycleMoment: "Immediately after signup",
    confidence: "medium" as const,
    entryTrigger: "contact_created",
    eligibility: ["Trial plan"],
    exclusions: ["Globally suppressed"],
    actions: ["Send onboarding draft", "Wait two days"],
    exitCondition: "activation_completed",
    failureBehavior: "Create an owner review task",
    consentRequirement: "Transactional relationship or matching topic consent",
    suppressionRules: "Recheck global and topic suppression before delivery",
    frequencyPolicy: "At most two lifecycle messages in seven days",
    requiredData: ["contact.plan"],
    requiredEvents: ["contact_created", "activation_completed"],
    requiredContent: ["Onboarding email"],
    dependenciesAndApprovals: ["Lifecycle owner approval"],
    deliveryHorizon: "Within two weeks",
    measurement: {
      outcomeMetric: { name: "Activation rate", proof: "activation_completed event" },
      earlySignal: { name: "Setup started", proof: "setup_started event" },
      baseline: { kind: "unknown" as const, discoveryTask: "Measure the previous 30 days" },
      successThreshold: "Activation rate improves by 5 percentage points",
    },
    immediateNextSteps: ["Confirm event coverage"],
    notIncluded: ["Marketing delivery"],
    assumptions: ["Events are emitted once"],
    followUpExperiment: null,
  };
}

describe("marketingAutomationBriefDefinitionSchema", () => {
  it("accepts every baseline variant with its required evidence", () => {
    const base = definition();
    for (const baseline of [
      { kind: "unknown" as const, discoveryTask: "Query the previous 30 days" },
      {
        kind: "assumption" as const,
        value: "20%",
        evidenceThatWouldChange: "A measured cohort differs by more than 3 points",
      },
      { kind: "measured" as const, value: "18%", source: "activation dashboard, 2026-07" },
    ]) {
      expect(
        marketingAutomationBriefDefinitionSchema.safeParse({
          ...base,
          measurement: { ...base.measurement, baseline },
        }).success,
      ).toBe(true);
    }
  });

  it("rejects incomplete baselines and more than three immediate actions", () => {
    const base = definition();
    expect(
      marketingAutomationBriefDefinitionSchema.safeParse({
        ...base,
        measurement: { ...base.measurement, baseline: { kind: "measured", value: "18%" } },
      }).success,
    ).toBe(false);
    expect(
      marketingAutomationBriefDefinitionSchema.safeParse({
        ...base,
        immediateNextSteps: ["one", "two", "three", "four"],
      }).success,
    ).toBe(false);
  });

  it("allows at most one structured follow-up experiment", () => {
    expect(
      marketingAutomationBriefDefinitionSchema.safeParse({
        ...definition(),
        followUpExperiment: {
          hypothesis: "Shorter delay improves setup starts",
          change: "Reduce the delay from two days to one",
          metric: "setup_started",
          decisionRule: "Ship when the guarded uplift is positive",
        },
      }).success,
    ).toBe(true);
    expect(
      marketingAutomationBriefDefinitionSchema.safeParse({
        ...definition(),
        followUpExperiment: [
          { hypothesis: "one", change: "one", metric: "one", decisionRule: "one" },
          { hypothesis: "two", change: "two", metric: "two", decisionRule: "two" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("project brief compatibility and workflow schemas", () => {
  it("defines every supported resource type from one exhaustive tuple", () => {
    expect(PROJECT_RESOURCE_TYPES).toEqual([
      "automation",
      "email_sequence",
      "segment",
      "form",
      "landing_page",
      "redirect",
    ]);
  });

  it("requires different owner and approver members", () => {
    const input = {
      name: "Activation",
      description: "",
      color: "#7c3aed",
      ownerUserId: "same-user",
      approverUserId: "same-user",
      primaryMotion: "onboarding",
      reviewAt: "2026-09-01T00:00:00.000Z",
      definition: definition(),
    };
    expect(projectBriefDraftInputSchema.safeParse(input).success).toBe(false);
  });

  it("requires a complete project/revision reference or no reference", () => {
    expect(projectBriefReferenceSchema.safeParse({}).success).toBe(true);
    expect(
      projectBriefReferenceSchema.safeParse({ projectId: "project-id", briefRevision: 3 }).success,
    ).toBe(true);
    expect(projectBriefReferenceSchema.safeParse({ projectId: "project-id" }).success).toBe(false);
    expect(projectBriefReferenceSchema.safeParse({ briefRevision: 3 }).success).toBe(false);
  });

  it("upcasts a legacy naked definition and rejects unknown document versions", () => {
    expect(projectBriefDocumentSchema.parse(definition())).toEqual({
      ...definition(),
      schemaVersion: 1,
    });
    expect(projectBriefDocumentSchema.parse({ ...definition(), schemaVersion: 1 })).toEqual({
      ...definition(),
      schemaVersion: 1,
    });
    expect(
      projectBriefDocumentSchema.safeParse({ ...definition(), schemaVersion: 2 }).success,
    ).toBe(false);
  });

  it("keeps the flat versioned document readable by the pre-migration definition schema", () => {
    expect(
      marketingAutomationBriefDefinitionSchema.parse({
        ...definition(),
        schemaVersion: 1,
      }),
    ).toEqual(definition());
  });

  it("declares each workflow transition and its legal source states", () => {
    expect(PROJECT_BRIEF_TRANSITIONS).toEqual({
      edit: { from: ["draft"], to: "draft" },
      submit: { from: ["draft"], to: "pending_approval" },
      approve: { from: ["pending_approval"], to: "approved" },
      reject: { from: ["pending_approval"], to: "draft" },
      withdraw: { from: ["pending_approval"], to: "draft" },
      reopen: { from: ["approved", "completed"], to: "draft" },
      complete: { from: ["approved"], to: "completed" },
    });
    expect(canProjectBriefTransition("submit", "draft")).toBe(true);
    expect(canProjectBriefTransition("submit", "approved")).toBe(false);
    expect(canProjectBriefTransition("reopen", "approved")).toBe(true);
    expect(canProjectBriefTransition("reopen", "completed")).toBe(true);
  });

  it("derives actor-specific actions without granting downgraded members access", () => {
    const brief = {
      status: "pending_approval" as const,
      ownerUserId: "owner-user",
      approverUserId: "approver-user",
    };
    expect(
      resolveProjectBriefAllowedActions(brief, {
        userId: "approver-user",
        role: "marketer",
      }),
    ).toMatchObject({ approve: true, reject: true, withdraw: false, edit: false });
    expect(
      resolveProjectBriefAllowedActions(brief, {
        userId: "approver-user",
        role: "viewer",
      }),
    ).toMatchObject({ approve: false, reject: false });
    expect(
      resolveProjectBriefAllowedActions(brief, { userId: "admin-user", role: "admin" }),
    ).toMatchObject({ withdraw: true, archive: true });
    expect(
      resolveProjectBriefAllowedActions(
        { ...brief, status: "approved" },
        { userId: "owner-user", role: "marketer" },
      ),
    ).toMatchObject({ reopen: true, complete: true, addResource: true, removeResource: true });
    expect(
      resolveProjectBriefAllowedActions(
        { ...brief, status: "completed" },
        { userId: "owner-user", role: "marketer" },
      ),
    ).toMatchObject({ reopen: true, complete: false, addResource: false, removeResource: false });
  });

  it("uses structured capability states rather than ambiguous booleans", () => {
    expect(marketingCapabilitySnapshotSchema.parse(DEFAULT_MARKETING_CAPABILITY_SNAPSHOT)).toEqual(
      DEFAULT_MARKETING_CAPABILITY_SNAPSHOT,
    );
    expect(
      marketingCapabilitySnapshotSchema.safeParse({
        marketingEmailDelivery: false,
        emailOpenTracking: false,
        emailClickTracking: false,
        ga4Integration: false,
      }).success,
    ).toBe(false);
  });

  it("rejects untrusted fields in an approved agent context", () => {
    const context = {
      projectId: "project-id",
      revision: 1,
      name: "Activation",
      primaryMotion: "onboarding",
      definition: definition(),
    } as const;
    expect(approvedMarketingBriefContextSchema.safeParse(context).success).toBe(true);
    expect(
      approvedMarketingBriefContextSchema.safeParse({ ...context, inventedMetric: "42%" }).success,
    ).toBe(false);
  });

  it("keeps unavailable linked resources visible with an explicit availability", () => {
    expect(
      projectLinkedResourceSchema.parse({
        resourceType: "email_sequence",
        resourceId: "deleted-template",
        name: "deleted-template",
        status: null,
        availability: "missing",
        briefRevision: 1,
        stale: false,
        createdAt: "2026-08-10T00:00:00.000Z",
      }).availability,
    ).toBe("missing");
  });
});
