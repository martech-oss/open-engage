import { describe, expect, it, vi } from "vitest";

import type { AutomationNode } from "@openengage/core/automations";
import { AUTOMATION_MAX_STARTS, type AutomationJobRow } from "@openengage/database/automations";

import { PermanentChannelError } from "../channels";
import { executeAutomationAction } from "./action-execution";
import type {
  AutomationActionDependencies,
  AutomationWorkerDependencies,
} from "./execution-dependencies";
import { processAutomationJob } from "./worker";

const now = "2026-09-11T00:00:00.000Z";
const action: AutomationNode = {
  id: "action",
  type: "action",
  position: { x: 0, y: 0 },
  config: { action: "change_score", amount: 7 },
};

function fixture(node: AutomationNode = action) {
  const job: AutomationJobRow = {
    id: "job",
    workspaceId: "workspace",
    enrollmentId: "enrollment",
    automationVersionId: "version",
    nodeId: node.id,
    contactId: "contact",
    idempotencyKey: "persisted-key",
    payload: {},
    status: "leased",
    leaseId: "lease",
    attempts: 1,
    createdAt: now,
    enteredAt: now,
    graph: {
      name: "Execution fixture",
      description: "",
      timezone: "UTC",
      nodes: [node],
      edges: [],
    },
    contactEmail: "contact@example.com",
    firstName: null,
    lastName: null,
    phone: null,
    stage: "lead",
    score: 0,
    customFields: {},
  };
  const dependencies = {
    jobs: {
      findJobForProcessing: vi
        .fn<AutomationWorkerDependencies["jobs"]["findJobForProcessing"]>()
        .mockResolvedValue(job),
      startLeasedJob: vi
        .fn<AutomationWorkerDependencies["jobs"]["startLeasedJob"]>()
        .mockResolvedValue(true),
      parkJobUntil: vi
        .fn<AutomationWorkerDependencies["jobs"]["parkJobUntil"]>()
        .mockResolvedValue(undefined),
      completeJobClosingEnrollment: vi
        .fn<AutomationWorkerDependencies["jobs"]["completeJobClosingEnrollment"]>()
        .mockResolvedValue(undefined),
      completeJobAdvancingEnrollment: vi
        .fn<AutomationWorkerDependencies["jobs"]["completeJobAdvancingEnrollment"]>()
        .mockResolvedValue(undefined),
    },
    recovery: {
      failJobAndEnrollmentForLease: vi
        .fn<AutomationWorkerDependencies["recovery"]["failJobAndEnrollmentForLease"]>()
        .mockResolvedValue(true),
      recordJobFailure: vi
        .fn<AutomationWorkerDependencies["recovery"]["recordJobFailure"]>()
        .mockResolvedValue("retry"),
    },
    nodes: {
      decisions: {
        captureCondition: vi
          .fn<AutomationWorkerDependencies["nodes"]["decisions"]["captureCondition"]>()
          .mockResolvedValue("yes"),
        hasContactEventSince: vi
          .fn<AutomationWorkerDependencies["nodes"]["decisions"]["hasContactEventSince"]>()
          .mockResolvedValue(false),
      },
      contactConditions: {
        contactHasTagWithSlug: vi
          .fn<AutomationWorkerDependencies["nodes"]["contactConditions"]["contactHasTagWithSlug"]>()
          .mockResolvedValue(false),
      },
      calls: {
        startChild: vi
          .fn<AutomationWorkerDependencies["nodes"]["calls"]["startChild"]>()
          .mockResolvedValue({ id: "child", status: "active", parked: true }),
      },
      executeAction: vi
        .fn<AutomationWorkerDependencies["nodes"]["executeAction"]>()
        .mockResolvedValue(undefined),
      clock: () => new Date(now),
    },
    clock: () => new Date(now),
  } satisfies AutomationWorkerDependencies;
  return { job, dependencies, run: () => processAutomationJob(job.id, "lease", dependencies) };
}

describe("automation worker with injected execution dependencies", () => {
  it("does not start or execute a job whose lease no longer resolves", async () => {
    const { dependencies, run } = fixture();
    dependencies.jobs.findJobForProcessing.mockResolvedValue(null);
    await run();
    expect(dependencies.jobs.startLeasedJob).not.toHaveBeenCalled();
    expect(dependencies.nodes.executeAction).not.toHaveBeenCalled();
    expect(dependencies.recovery.recordJobFailure).not.toHaveBeenCalled();
  });

  it("fails an exhausted denied start under the original lease without executing", async () => {
    const { job, dependencies, run } = fixture();
    job.attempts = AUTOMATION_MAX_STARTS;
    dependencies.jobs.startLeasedJob.mockResolvedValue(false);
    await run();
    expect(dependencies.recovery.failJobAndEnrollmentForLease).toHaveBeenCalledWith(
      "job",
      "lease",
      "Automation attempts exhausted",
      now,
    );
    expect(dependencies.nodes.executeAction).not.toHaveBeenCalled();
  });

  it("resumes a running job even when the leased-to-running transition already happened", async () => {
    const { job, dependencies, run } = fixture();
    job.status = "running";
    dependencies.jobs.startLeasedJob.mockResolvedValue(false);
    await run();
    expect(dependencies.nodes.executeAction).toHaveBeenCalledWith(action.config, job, "lease");
    expect(dependencies.jobs.completeJobClosingEnrollment).toHaveBeenCalledWith(job, "lease", now);
  });

  it.each(["retry", "failed", "stale"] as const)(
    "honors the persisted %s outcome after a transient action failure",
    async (outcome) => {
      const { dependencies, run } = fixture();
      const error = new Error("delivery unavailable");
      dependencies.nodes.executeAction.mockRejectedValue(error);
      dependencies.recovery.recordJobFailure.mockResolvedValue(outcome);
      const result = await run().then(
        () => null,
        (failure: unknown) => failure,
      );
      expect(result).toBe(outcome === "retry" ? error : null);
      expect(dependencies.recovery.recordJobFailure).toHaveBeenCalledWith(
        "job",
        "lease",
        error.message,
        now,
        false,
      );
      expect(dependencies.jobs.completeJobClosingEnrollment).not.toHaveBeenCalled();
    },
  );

  it("preserves PermanentChannelError identity even when failure recording finds a stale lease", async () => {
    const { dependencies, run } = fixture();
    const error = new PermanentChannelError("unsupported action");
    dependencies.nodes.executeAction.mockRejectedValue(error);
    dependencies.recovery.recordJobFailure.mockResolvedValue("stale");
    await expect(run()).rejects.toBe(error);
    expect(dependencies.recovery.recordJobFailure).toHaveBeenCalledWith(
      "job",
      "lease",
      error.message,
      now,
      true,
    );
  });

  it("propagates persistence failure while recording an action failure for queue retry", async () => {
    const { dependencies, run } = fixture();
    dependencies.nodes.executeAction.mockRejectedValue(new Error("action failed"));
    const recoveryError = new Error("D1 unavailable");
    dependencies.recovery.recordJobFailure.mockRejectedValue(recoveryError);
    await expect(run()).rejects.toBe(recoveryError);
  });

  it("recovers a completion failure after executing the action exactly once in this attempt", async () => {
    const { dependencies, run } = fixture();
    const error = new Error("completion failed");
    dependencies.jobs.completeJobClosingEnrollment.mockRejectedValue(error);
    await expect(run()).rejects.toBe(error);
    expect(dependencies.nodes.executeAction).toHaveBeenCalledOnce();
    expect(dependencies.recovery.recordJobFailure).toHaveBeenCalledWith(
      "job",
      "lease",
      error.message,
      now,
      false,
    );
  });

  it("leaves a parent parked by startChild without independently parking or completing it", async () => {
    const { job, dependencies, run } = fixture({
      ...action,
      config: { action: "call_automation", automationId: "child-definition", mode: "await" },
    });
    await run();
    expect(dependencies.nodes.calls.startChild).toHaveBeenCalledWith(job, "lease", "await", now);
    expect(dependencies.nodes.executeAction).not.toHaveBeenCalled();
    expect(dependencies.jobs.parkJobUntil).not.toHaveBeenCalled();
    expect(dependencies.jobs.completeJobClosingEnrollment).not.toHaveBeenCalled();
  });

  it("persists event waiting metadata relative to the job creation time", async () => {
    const { dependencies, run } = fixture({
      id: "decision",
      type: "decision",
      position: { x: 0, y: 0 },
      config: { event: "clicked", withinMinutes: 5, resourceId: "email" },
    });
    await run();
    expect(dependencies.nodes.decisions.hasContactEventSince).toHaveBeenCalledWith(
      "workspace",
      "contact",
      "email_clicked",
      now,
      "email",
    );
    expect(dependencies.jobs.parkJobUntil).toHaveBeenCalledWith("job", "lease", {
      dueAt: "2026-09-11T00:05:00.000Z",
      payload: '{"waiting":true}',
      now,
      waitEventType: "email_clicked",
      waitResourceId: "email",
      waitStartedAt: now,
    });
    expect(dependencies.jobs.completeJobClosingEnrollment).not.toHaveBeenCalled();
  });

  it("does not complete when durable condition capture loses its lease", async () => {
    const { dependencies, run } = fixture({
      id: "condition",
      type: "condition",
      position: { x: 0, y: 0 },
      config: { field: "score", operator: "gte", value: 7 },
    });
    dependencies.nodes.decisions.captureCondition.mockRejectedValue(
      new Error("Automation condition lease lost"),
    );
    dependencies.recovery.recordJobFailure.mockResolvedValue("stale");
    await run();
    expect(dependencies.jobs.completeJobClosingEnrollment).not.toHaveBeenCalled();
    expect(dependencies.jobs.completeJobAdvancingEnrollment).not.toHaveBeenCalled();
  });
});

function actionDependencies() {
  return {
    actionRepository: {
      adjustContactScoreForJob: vi
        .fn<AutomationActionDependencies["actionRepository"]["adjustContactScoreForJob"]>()
        .mockResolvedValue(undefined),
      hasRunningLease: vi
        .fn<AutomationActionDependencies["actionRepository"]["hasRunningLease"]>()
        .mockResolvedValue(true),
    },
    contactActions: {
      addContactTag: vi.fn<AutomationActionDependencies["contactActions"]["addContactTag"]>(),
      removeContactTag: vi.fn<AutomationActionDependencies["contactActions"]["removeContactTag"]>(),
      addAutomationSegmentMembership: vi
        .fn<AutomationActionDependencies["contactActions"]["addAutomationSegmentMembership"]>()
        .mockResolvedValue(false),
      removeSegmentMembership:
        vi.fn<AutomationActionDependencies["contactActions"]["removeSegmentMembership"]>(),
      updateContactColumn:
        vi.fn<AutomationActionDependencies["contactActions"]["updateContactColumn"]>(),
      replaceContactCustomFields:
        vi.fn<AutomationActionDependencies["contactActions"]["replaceContactCustomFields"]>(),
    },
    effects: {
      upsertProjectMember: vi.fn<AutomationActionDependencies["effects"]["upsertProjectMember"]>(),
      handoffToSales: vi.fn<AutomationActionDependencies["effects"]["handoffToSales"]>(),
      createEmailDelivery: vi.fn<AutomationActionDependencies["effects"]["createEmailDelivery"]>(),
      createWebhookDelivery:
        vi.fn<AutomationActionDependencies["effects"]["createWebhookDelivery"]>(),
      recordSegmentJoined: vi.fn<AutomationActionDependencies["effects"]["recordSegmentJoined"]>(),
      reconcileContact: vi.fn<AutomationActionDependencies["effects"]["reconcileContact"]>(),
    },
    clock: () => new Date(now),
  } satisfies AutomationActionDependencies;
}

describe("automation action failure and reconciliation boundaries", () => {
  it("checks the lease after the effect and skips reconciliation after lease loss", async () => {
    const { job } = fixture();
    const dependencies = actionDependencies();
    dependencies.actionRepository.adjustContactScoreForJob.mockImplementation(async () => {
      dependencies.actionRepository.hasRunningLease.mockResolvedValue(false);
    });
    await executeAutomationAction(
      { action: "change_score", amount: 7 },
      job,
      "lease",
      dependencies,
    );
    expect(dependencies.actionRepository.adjustContactScoreForJob).toHaveBeenCalledWith(
      job,
      "lease",
      7,
      now,
      { operation: undefined, categoryId: undefined },
    );
    expect(dependencies.actionRepository.hasRunningLease).toHaveBeenCalledWith(job, "lease");
    expect(dependencies.effects.reconcileContact).not.toHaveBeenCalled();
  });

  it("propagates an effect failure without attempting reconciliation", async () => {
    const { job } = fixture();
    const dependencies = actionDependencies();
    const error = new Error("effect failed");
    dependencies.actionRepository.adjustContactScoreForJob.mockRejectedValue(error);
    await expect(
      executeAutomationAction({ action: "change_score", amount: 7 }, job, "lease", dependencies),
    ).rejects.toBe(error);
    expect(dependencies.actionRepository.hasRunningLease).not.toHaveBeenCalled();
    expect(dependencies.effects.reconcileContact).not.toHaveBeenCalled();
  });

  it("propagates queue failure after the action so the worker can recover the attempt", async () => {
    const { job } = fixture();
    const dependencies = actionDependencies();
    const error = new Error("queue failed");
    dependencies.effects.reconcileContact.mockRejectedValue(error);
    await expect(
      executeAutomationAction({ action: "change_score", amount: 7 }, job, "lease", dependencies),
    ).rejects.toBe(error);
    expect(dependencies.effects.reconcileContact).toHaveBeenCalledWith("workspace", "contact");
  });

  it.each([false, true])(
    "records a segment event only when membership was inserted: %s",
    async (inserted) => {
      const { job } = fixture();
      const dependencies = actionDependencies();
      dependencies.contactActions.addAutomationSegmentMembership.mockResolvedValue(inserted);
      await executeAutomationAction(
        { action: "add_segment", segmentId: "segment" },
        job,
        "lease",
        dependencies,
      );
      expect(dependencies.contactActions.addAutomationSegmentMembership).toHaveBeenCalledWith(
        job,
        "lease",
        "segment",
        now,
      );
      expect(dependencies.effects.recordSegmentJoined).toHaveBeenCalledTimes(inserted ? 1 : 0);
    },
  );
});
