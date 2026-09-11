import { ContactRepository } from "@openengage/database/contacts";
import {
  DealRecordRepository,
  DealTaskRepository,
  SalesRepository,
} from "@openengage/database/deals";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { reconcileContactSegmentMemberships } from "../segments/membership-service";

export const salesProcedures = {
  salesMembers: authed.deals.salesMembers.handler(({ context }) =>
    new SalesRepository(context.database, context.workspace).eligibleMembers(),
  ),
  handoff: authed.deals.handoff.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    let result;
    try {
      result = await new SalesRepository(context.database, context.workspace).handoff(input);
    } catch (error) {
      throw errors.INVALID_DEAL_REFERENCE({
        message: error instanceof Error ? error.message : "Handoff failed",
      });
    }
    await reconcileContactSegmentMemberships(
      context.database,
      context.workspace.workspaceId,
      input.contactId,
    );
    return result;
  }),
  assignmentGroups: authed.deals.assignmentGroups.handler(({ context }) =>
    new SalesRepository(context.database, context.workspace).listGroups(),
  ),
  saveAssignmentGroup: authed.deals.saveAssignmentGroup.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      try {
        return await new SalesRepository(context.database, context.workspace).saveGroup(input);
      } catch (error) {
        throw errors.INVALID_DEAL_REFERENCE({
          message: error instanceof Error ? error.message : "Invalid group",
        });
      }
    },
  ),
  deleteAssignmentGroup: authed.deals.deleteAssignmentGroup.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      await new SalesRepository(context.database, context.workspace).deleteGroup(input.id);
      return ack;
    },
  ),
  notifications: authed.deals.notifications.handler(({ context }) =>
    new SalesRepository(context.database, context.workspace).notifications(
      context.workspace.userId,
    ),
  ),
  readNotification: authed.deals.readNotification.handler(async ({ context, input }) => {
    await new SalesRepository(context.database, context.workspace).markNotificationRead(
      input.id,
      context.workspace.userId,
    );
    return ack;
  }),
  contactTasks: authed.deals.contactTasks.handler(({ context, input }) =>
    new DealTaskRepository(context.database, context.workspace).listContactTasks(input.contactId),
  ),
  createContactTask: authed.deals.createContactTask.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const contact = input.contactId
      ? await new ContactRepository(context.database, context.workspace).getContact(input.contactId)
      : null;
    const deal = input.dealId
      ? await new DealRecordRepository(context.database, context.workspace).getDeal(input.dealId)
      : null;
    if (
      (input.contactId && !contact) ||
      (input.dealId && !deal) ||
      (input.contactId && deal && deal.contactId !== input.contactId)
    )
      throw errors.INVALID_DEAL_REFERENCE({
        message: "Contact and deal must exist in this workspace and agree",
      });
    if (
      input.assignedUserId &&
      !(await new SalesRepository(context.database, context.workspace).eligibleUser(
        input.assignedUserId,
      ))
    )
      throw errors.INVALID_DEAL_REFERENCE({ message: "Assignee must be able to manage marketing" });
    return new DealTaskRepository(context.database, context.workspace).createContactTask({
      ...input,
      contactId: input.contactId ?? deal?.contactId ?? null,
    });
  }),
  updateTaskResource: authed.deals.updateTaskResource.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      if (
        input.assignedUserId &&
        !(await new SalesRepository(context.database, context.workspace).eligibleUser(
          input.assignedUserId,
        ))
      )
        throw errors.INVALID_DEAL_REFERENCE({
          message: "Assignee must be able to manage marketing",
        });
      const { taskId, ...changes } = input;
      const task = await new DealTaskRepository(context.database, context.workspace).updateTaskById(
        taskId,
        changes,
      );
      if (!task) throw errors.DEAL_TASK_NOT_FOUND();
      return task;
    },
  ),
  deleteTaskResource: authed.deals.deleteTaskResource.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      if (
        !(await new DealTaskRepository(context.database, context.workspace).deleteTaskById(
          input.taskId,
        ))
      )
        throw errors.DEAL_TASK_NOT_FOUND();
      return ack;
    },
  ),
  setTaskStatus: authed.deals.setTaskStatus.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const task = await new DealTaskRepository(context.database, context.workspace).setTaskStatus(
      input.taskId,
      input.status,
    );
    if (!task) throw errors.DEAL_TASK_NOT_FOUND();
    return task;
  }),
};
