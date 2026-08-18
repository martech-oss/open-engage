import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import {
  archiveDeal,
  archiveDealPipeline,
  createDeal,
  createDealPipeline,
  createDealTask,
  deleteDealTask,
  getDealDetail,
  getDealOptions,
  listDeals,
  listWorkspaceDealTasks,
  moveDeal,
  updateDeal,
  updateDealPipeline,
  updateDealTask,
} from "./service";

export const dealOptionsProcedure = authed.deals.options.handler(({ context }) =>
  getDealOptions(context.database, context.workspace),
);

export const listDealsProcedure = authed.deals.list.handler(async ({ context, input, errors }) => {
  const outcome = await listDeals(context.database, context.workspace, input);
  if (outcome.kind === "pipeline_not_found") throw errors.DEAL_PIPELINE_NOT_FOUND();
  return outcome.data;
});

export const listDealTasksProcedure = authed.deals.listTasks.handler(({ context, input }) =>
  listWorkspaceDealTasks(context.database, context.workspace, input.status),
);

export const createPipelineProcedure = authed.deals.createPipeline.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createDealPipeline(
      context.database,
      context.workspace,
      input,
      context.executionContext,
    );
    if (outcome.kind === "conflict") throw errors.DEAL_PIPELINE_CONFLICT();
    return outcome.pipeline;
  },
);

export const updatePipelineProcedure = authed.deals.updatePipeline.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    const outcome = await updateDealPipeline(
      context.database,
      context.workspace,
      id,
      changes,
      context.executionContext,
    );
    if (outcome.kind === "not_found") throw errors.DEAL_PIPELINE_NOT_FOUND();
    if (outcome.kind === "conflict") throw errors.DEAL_PIPELINE_CONFLICT();
    if (outcome.kind === "stage_in_use") throw errors.DEAL_STAGE_IN_USE();
    return outcome.pipeline;
  },
);

export const archivePipelineProcedure = authed.deals.archivePipeline.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await archiveDealPipeline(
      context.database,
      context.workspace,
      input.id,
      context.executionContext,
    );
    if (outcome.kind === "not_found") throw errors.DEAL_PIPELINE_NOT_FOUND();
    if (outcome.kind === "last") throw errors.LAST_DEAL_PIPELINE();
    if (outcome.kind === "in_use") throw errors.DEAL_PIPELINE_IN_USE();
    return ack;
  },
);

export const getDealProcedure = authed.deals.get.handler(async ({ context, input, errors }) => {
  const detail = await getDealDetail(context.database, context.workspace, input.id);
  if (!detail) throw errors.DEAL_NOT_FOUND();
  return detail;
});

export const createDealProcedure = authed.deals.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createDeal(
      context.database,
      context.workspace,
      input,
      context.executionContext,
    );
    if (outcome.kind === "invalid_reference") {
      throw errors.INVALID_DEAL_REFERENCE({ message: outcome.message });
    }
    if (outcome.kind === "not_found") throw errors.INVALID_DEAL_REFERENCE();
    return outcome.deal;
  },
);

export const updateDealProcedure = authed.deals.update.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    const outcome = await updateDeal(
      context.database,
      context.workspace,
      id,
      changes,
      context.executionContext,
    );
    if (outcome.kind === "not_found") throw errors.DEAL_NOT_FOUND();
    if (outcome.kind === "invalid_reference") {
      throw errors.INVALID_DEAL_REFERENCE({ message: outcome.message });
    }
    return outcome.deal;
  },
);

export const moveDealProcedure = authed.deals.move.handler(async ({ context, input, errors }) => {
  requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
  const outcome = await moveDeal(
    context.database,
    context.workspace,
    input.id,
    input.stageId,
    context.executionContext,
  );
  if (outcome.kind === "not_found") throw errors.DEAL_NOT_FOUND();
  if (outcome.kind === "invalid_stage") throw errors.INVALID_DEAL_STAGE();
  return outcome.deal;
});

export const archiveDealProcedure = authed.deals.archive.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    if (
      !(await archiveDeal(context.database, context.workspace, input.id, context.executionContext))
    ) {
      throw errors.DEAL_NOT_FOUND();
    }
    return ack;
  },
);

export const createDealTaskProcedure = authed.deals.createTask.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { dealId, ...task } = input;
    const outcome = await createDealTask(context.database, context.workspace, dealId, task);
    if (outcome.kind === "not_found") throw errors.DEAL_NOT_FOUND();
    if (outcome.kind === "invalid_assignee") throw errors.INVALID_DEAL_TASK_ASSIGNEE();
    return outcome.task;
  },
);

export const updateDealTaskProcedure = authed.deals.updateTask.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { dealId, taskId, ...changes } = input;
    const outcome = await updateDealTask(
      context.database,
      context.workspace,
      dealId,
      taskId,
      changes,
    );
    if (outcome.kind === "not_found") throw errors.DEAL_TASK_NOT_FOUND();
    if (outcome.kind === "invalid_assignee") throw errors.INVALID_DEAL_TASK_ASSIGNEE();
    return outcome.task;
  },
);

export const deleteDealTaskProcedure = authed.deals.deleteTask.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await deleteDealTask(context.database, context.workspace, input.dealId, input.taskId))) {
      throw errors.DEAL_TASK_NOT_FOUND();
    }
    return ack;
  },
);

export const dealProcedures = {
  options: dealOptionsProcedure,
  list: listDealsProcedure,
  listTasks: listDealTasksProcedure,
  createPipeline: createPipelineProcedure,
  updatePipeline: updatePipelineProcedure,
  archivePipeline: archivePipelineProcedure,
  get: getDealProcedure,
  create: createDealProcedure,
  update: updateDealProcedure,
  move: moveDealProcedure,
  archive: archiveDealProcedure,
  createTask: createDealTaskProcedure,
  updateTask: updateDealTaskProcedure,
  deleteTask: deleteDealTaskProcedure,
};
