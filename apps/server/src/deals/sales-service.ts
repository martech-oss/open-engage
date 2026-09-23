import type { ContactTaskCreate, DealTaskUpdate, SalesHandoff } from "@openengage/core/deals";
import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { ContactRepository } from "@openengage/database/contacts";
import {
  DealRecordRepository,
  DealTaskRepository,
  SalesReferenceError,
  SalesRepository,
} from "@openengage/database/deals";

import { reconcileContactSegmentMemberships } from "../segments/membership-service";

type InvalidReference = { kind: "invalid_reference"; message: string };

const INELIGIBLE_ASSIGNEE: InvalidReference = {
  kind: "invalid_reference",
  message: "Assignee must be able to manage marketing",
};

/** Hands a contact to sales, then reconciles the segments its new owner and lifecycle affect. */
export async function handoffToSales(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: SalesHandoff,
) {
  let result;
  try {
    result = await new SalesRepository(database, workspace).handoff(input);
  } catch (error) {
    if (!(error instanceof SalesReferenceError)) throw error;
    return { kind: "invalid_reference", message: error.message } satisfies InvalidReference;
  }
  await reconcileContactSegmentMemberships(database, workspace.workspaceId, input.contactId);
  return { kind: "ok" as const, result };
}

export async function createContactTask(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: ContactTaskCreate,
) {
  const contact = input.contactId
    ? await new ContactRepository(database, workspace).getContact(input.contactId)
    : null;
  const deal = input.dealId
    ? await new DealRecordRepository(database, workspace).getDeal(input.dealId)
    : null;
  if (
    (input.contactId && !contact) ||
    (input.dealId && !deal) ||
    (input.contactId && deal && deal.contactId !== input.contactId)
  ) {
    return {
      kind: "invalid_reference",
      message: "Contact and deal must exist in this workspace and agree",
    } satisfies InvalidReference;
  }
  if (!(await isEligibleAssignee(database, workspace, input.assignedUserId))) {
    return INELIGIBLE_ASSIGNEE;
  }
  const task = await new DealTaskRepository(database, workspace).createContactTask({
    ...input,
    contactId: input.contactId ?? deal?.contactId ?? null,
  });
  return { kind: "ok" as const, task };
}

export async function updateTask(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  taskId: string,
  changes: DealTaskUpdate,
) {
  if (!(await isEligibleAssignee(database, workspace, changes.assignedUserId))) {
    return INELIGIBLE_ASSIGNEE;
  }
  const task = await new DealTaskRepository(database, workspace).updateTaskById(taskId, changes);
  return task ? { kind: "ok" as const, task } : { kind: "not_found" as const };
}

async function isEligibleAssignee(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  userId: string | null | undefined,
): Promise<boolean> {
  return !userId || (await new SalesRepository(database, workspace).eligibleUser(userId));
}
