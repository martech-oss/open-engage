import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { ProjectBriefMutation } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import { createDatabase, member, SegmentRepository, user, uuidv7 } from "@openengage/database";

import {
  approvedProjectBriefContext,
  completeProjectBrief,
  createProjectBrief,
  getProjectBrief,
  ProjectBriefServiceError,
  reopenProjectBrief,
  reviewProjectBrief,
  submitProjectBrief,
  updateProjectBrief,
} from "../src/web/project-brief-service";
import { seedWorkspaceContext } from "./factory";

describe("project brief workflow", () => {
  it("locks, approves, links, reopens, and marks old revision resources stale", async () => {
    const owner = await seedWorkspaceContext(env.DB, "brief-owner", "owner");
    const approver = await addMember(owner, "brief-approver", "marketer");
    const input = briefInput(owner.userId, approver.userId);
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
    expect((await getProjectBrief(createDatabase(env.DB), owner, id)).items).toEqual([
      expect.objectContaining({
        resourceType: "segment",
        resourceId: segment.id,
        briefRevision: 1,
        stale: false,
      }),
    ]);

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
    const approver = await addMember(first, "brief-first-approver", "marketer");
    const second = await seedWorkspaceContext(env.DB, "brief-second", "owner");
    const { id } = await createProjectBrief(
      createDatabase(env.DB),
      first,
      briefInput(first.userId, approver.userId),
    );

    await expect(getProjectBrief(createDatabase(env.DB), second, id)).rejects.toMatchObject({
      kind: "not_found",
    });
    await expect(
      createProjectBrief(createDatabase(env.DB), first, briefInput(first.userId, second.userId)),
    ).rejects.toBeInstanceOf(ProjectBriefServiceError);
  });
});

async function addMember(
  workspace: WorkspaceContext,
  label: string,
  role: "admin" | "marketer",
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

function briefInput(ownerUserId: string, approverUserId: string): ProjectBriefMutation {
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
