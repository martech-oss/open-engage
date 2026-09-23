import {
  DealTaskRepository,
  SalesReferenceError,
  SalesRepository,
} from "@openengage/database/deals";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { createContactTask, handoffToSales, updateTask } from "./sales-service";

export const salesProcedures = {
  salesMembers: authed.deals.salesMembers.handler(({ context }) =>
    new SalesRepository(context.database, context.workspace).eligibleMembers(),
  ),
  handoff: authed.deals.handoff.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await handoffToSales(context.database, context.workspace, input);
    if (outcome.kind === "invalid_reference") {
      throw errors.INVALID_DEAL_REFERENCE({ message: outcome.message });
    }
    return outcome.result;
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
        if (!(error instanceof SalesReferenceError)) throw error;
        throw errors.INVALID_DEAL_REFERENCE({ message: error.message });
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
    const outcome = await createContactTask(context.database, context.workspace, input);
    if (outcome.kind === "invalid_reference") {
      throw errors.INVALID_DEAL_REFERENCE({ message: outcome.message });
    }
    return outcome.task;
  }),
  updateTaskResource: authed.deals.updateTaskResource.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      const { taskId, ...changes } = input;
      const outcome = await updateTask(context.database, context.workspace, taskId, changes);
      switch (outcome.kind) {
        case "ok":
          return outcome.task;
        case "not_found":
          throw errors.DEAL_TASK_NOT_FOUND();
        case "invalid_reference":
          throw errors.INVALID_DEAL_REFERENCE({ message: outcome.message });
      }
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
