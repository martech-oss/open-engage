import { describe, expect, it } from "vitest";

import { marketingAutomationBriefDefinitionSchema } from "./schema.js";

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
