import { automationNumber } from "@openengage/core/automations";
import type { AutomationContactColumn, AutomationJobRow } from "@openengage/database/automations";

import { PermanentChannelError } from "../channels";
import { primitiveString } from "../platform/values";
import {
  dispatchAutomationAction,
  type AutomationAction,
  type AutomationActionExecutorRegistry,
} from "./action-dispatch";
import type { AutomationActionDependencies } from "./execution-dependencies";

interface AutomationActionExecutionContext extends AutomationActionDependencies {
  job: AutomationJobRow;
  leaseId: string;
  now: string;
}

const automationActionExecutors = {
  call_automation: async () => {
    throw new PermanentChannelError("Callable actions require parent/child execution");
  },
  upsert_project_member: async (action, context) => {
    await context.effects.upsertProjectMember(action, context.job, context.leaseId);
  },
  handoff_to_sales: async (action, context) => {
    await context.effects.handoffToSales(action, context.job, context.leaseId);
  },
  send_email: async (action, context) => {
    await context.effects.createEmailDelivery(action, context.job, context.leaseId);
  },
  send_webhook: async (action, context) => {
    await context.effects.createWebhookDelivery(action.endpointId, context.job, context.leaseId);
  },
  add_tag: async (action, context) => {
    await context.contactActions.addContactTag(
      context.job,
      context.leaseId,
      action.tagId,
      context.now,
    );
  },
  remove_tag: async (action, context) => {
    await context.contactActions.removeContactTag(context.job, context.leaseId, action.tagId);
  },
  add_segment: async (action, context) => {
    if (
      await context.contactActions.addAutomationSegmentMembership(
        context.job,
        context.leaseId,
        action.segmentId,
        context.now,
      )
    ) {
      await context.effects.recordSegmentJoined(context.job, action.segmentId);
    }
  },
  remove_segment: async (action, context) => {
    await context.contactActions.removeSegmentMembership(
      context.job,
      context.leaseId,
      action.segmentId,
    );
  },
  change_score: async (action, context) => {
    await context.actionRepository.adjustContactScoreForJob(
      context.job,
      context.leaseId,
      automationNumber(action.amount),
      context.now,
      { operation: action.operation, categoryId: action.categoryId },
    );
  },
  update_field: async (action, context) => {
    await updateContactField(
      context.job,
      context.leaseId,
      action.field,
      action.value,
      context.contactActions,
      context.clock,
    );
  },
} satisfies AutomationActionExecutorRegistry<AutomationActionExecutionContext>;

export async function executeAutomationAction(
  action: AutomationAction,
  job: AutomationJobRow,
  leaseId: string,
  dependencies: AutomationActionDependencies,
): Promise<void> {
  await dispatchAutomationAction(automationActionExecutors, action, {
    ...dependencies,
    job,
    leaseId,
    now: dependencies.clock().toISOString(),
  });
  if (await dependencies.actionRepository.hasRunningLease(job, leaseId)) {
    await dependencies.effects.reconcileContact(job.workspaceId, job.contactId);
  }
}

async function updateContactField(
  job: AutomationJobRow,
  leaseId: string,
  field: string,
  value: unknown,
  contactActions: AutomationActionDependencies["contactActions"],
  clock: () => Date,
): Promise<void> {
  const columns: Record<string, AutomationContactColumn> = {
    first_name: "first_name",
    last_name: "last_name",
    phone: "phone",
    stage: "stage",
    external_id: "external_id",
  };
  const column = columns[field];
  if (column) {
    await contactActions.updateContactColumn(
      job,
      leaseId,
      column,
      primitiveString(value),
      clock().toISOString(),
    );
    return;
  }
  if (!/^[A-Za-z0-9_.-]{1,191}$/.test(field)) {
    throw new PermanentChannelError("Invalid custom field key");
  }
  const fields = { ...job.customFields };
  fields[field] = value;
  await contactActions.replaceContactCustomFields(
    job,
    leaseId,
    JSON.stringify(fields),
    clock().toISOString(),
  );
}
