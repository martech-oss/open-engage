import { env } from "cloudflare:workers";

import type { ProjectBriefMutation } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import { createDatabase, member, user, uuidv7 } from "@openengage/database";

export async function addProjectBriefMember(
  workspace: WorkspaceContext,
  label: string,
  role: "admin" | "marketer" | "viewer",
): Promise<WorkspaceContext> {
  const userId = uuidv7();
  const now = new Date();
  const database = createDatabase(env.DB);
  await database.orm.batch([
    database.orm.insert(user).values({
      id: userId,
      name: label,
      email: `${label}-${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }),
    database.orm.insert(member).values({
      id: uuidv7(),
      organizationId: workspace.workspaceId,
      userId,
      role,
      createdAt: now,
    }),
  ]);
  return { workspaceId: workspace.workspaceId, userId, role };
}

export function projectBriefInput(
  ownerUserId: string,
  approverUserId: string,
): ProjectBriefMutation {
  return {
    name: "Trial activation",
    description: "Move new trials to activation",
    color: "#7c3aed",
    ownerUserId,
    approverUserId,
    primaryMotion: "onboarding",
    reviewAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    definition: {
      outcome: "Increase trial activation",
      audience: "New trial contacts",
      lifecycleMoment: "After account creation",
      confidence: "medium",
      entryTrigger: "contact_created",
      eligibility: ["Trial plan"],
      exclusions: ["Globally suppressed"],
      actions: ["Create onboarding email draft"],
      exitCondition: "activation_completed",
      failureBehavior: "Assign a manual review task",
      consentRequirement: "Applicable topic consent",
      suppressionRules: "Global and topic suppression",
      frequencyPolicy: "Maximum two messages in seven days",
      requiredData: ["contact.plan"],
      requiredEvents: ["activation_completed"],
      requiredContent: ["Onboarding email"],
      dependenciesAndApprovals: ["Owner approval"],
      deliveryHorizon: "Within two weeks",
      measurement: {
        outcomeMetric: { name: "Activation rate", proof: "activation_completed event" },
        earlySignal: { name: "Setup started", proof: "setup_started event" },
        baseline: { kind: "unknown", discoveryTask: "Measure the previous 30 days" },
        successThreshold: "Improve by 5 percentage points",
      },
      immediateNextSteps: ["Verify events"],
      notIncluded: ["Marketing delivery"],
      assumptions: ["Event delivery is reliable"],
      followUpExperiment: null,
    },
  };
}
