import { automationString } from "@openengage/core/automations";
import {
  AutomationActionRepository,
  AutomationCallRepository,
  AutomationContactActionRepository,
  AutomationDecisionRepository,
  AutomationJobRecoveryRepository,
  AutomationJobRepository,
} from "@openengage/database/automations";
import { createDatabase } from "@openengage/database/client";
import { SalesRepository } from "@openengage/database/deals";

import { executeAutomationAction } from "../automations/action-execution";
import type {
  AutomationActionDependencies,
  AutomationWorkerDependencies,
} from "../automations/execution-dependencies";
import type { RuntimeEnv } from "../env";
import { createEmailDelivery, createWebhookDelivery } from "../messaging/delivery-worker";
import { mutateProjectMember } from "../projects/program-service";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";
import { recordContactEvent } from "./contact-event-service";

export function createAutomationExecutionDependencies(
  env: RuntimeEnv,
): AutomationWorkerDependencies {
  const database = createDatabase(env.DB);
  const clock = () => new Date();
  const contactActions = new AutomationContactActionRepository(database);
  const actions: AutomationActionDependencies = {
    actionRepository: new AutomationActionRepository(database),
    contactActions,
    clock,
    effects: {
      upsertProjectMember: async (action, job, leaseId) => {
        await mutateProjectMember(
          database,
          { workspaceId: job.workspaceId },
          {
            projectId: action.projectId,
            contactId: job.contactId,
            ...(action.statusId ? { statusId: action.statusId } : {}),
            source: "automation",
            idempotencyKey: `automation:${job.enrollmentId}:${job.nodeId}`,
            authority: { jobId: job.id, leaseId, enrollmentId: job.enrollmentId },
          },
        );
      },
      handoffToSales: async (action, job, leaseId) => {
        await new SalesRepository(database, { workspaceId: job.workspaceId }).handoffForAutomation(
          {
            ...action,
            title: automationString(action.title),
            contactId: job.contactId,
            executionKey: `automation:${job.enrollmentId}:${job.nodeId}`,
          },
          job.id,
          leaseId,
        );
      },
      createEmailDelivery: async (action, job, leaseId) => {
        await createEmailDelivery(action, job, leaseId, env, database);
      },
      createWebhookDelivery: async (endpointId, job, leaseId) => {
        await createWebhookDelivery(endpointId, job, leaseId, env, database);
      },
      recordSegmentJoined: async (job, segmentId) => {
        await recordContactEvent(database, {
          workspaceId: job.workspaceId,
          contactId: job.contactId,
          type: "segment_joined",
          resourceType: "segment",
          resourceId: segmentId,
          queue: env.JOBS_QUEUE,
        });
      },
      reconcileContact: async (workspaceId, contactId) => {
        await enqueueSegmentContactReconciliation(env.JOBS_QUEUE, workspaceId, [contactId]);
      },
    },
  };
  return {
    jobs: new AutomationJobRepository(database),
    recovery: new AutomationJobRecoveryRepository(database),
    clock,
    nodes: {
      decisions: new AutomationDecisionRepository(database),
      contactConditions: contactActions,
      calls: new AutomationCallRepository(database),
      clock,
      executeAction: (action, job, leaseId) =>
        executeAutomationAction(action, job, leaseId, actions),
    },
  };
}
