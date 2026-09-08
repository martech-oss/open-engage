import { CampaignCostRepository } from "@openengage/database/projects";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";

export const costProcedures = {
  listCosts: authed.projects.listCosts.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const repository = new CampaignCostRepository(context.database, context.workspace);
    if (!(await repository.hasProject(input.id))) throw errors.PROJECT_NOT_FOUND();
    return await repository.list(input.id);
  }),
  createCost: authed.projects.createCost.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new CampaignCostRepository(context.database, context.workspace);
    if (!(await repository.hasProject(input.id))) throw errors.PROJECT_NOT_FOUND();
    const { id, costId, ...cost } = input;
    if (!(await repository.create(id, costId, cost))) throw errors.COST_CONFLICT();
    return ack;
  }),
  updateCost: authed.projects.updateCost.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new CampaignCostRepository(context.database, context.workspace);
    const { id, costId, ...cost } = input;
    if (!(await repository.hasProject(id)) || !(await repository.update(id, costId, cost)))
      throw errors.PROJECT_NOT_FOUND();
    return ack;
  }),
  deleteCost: authed.projects.deleteCost.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new CampaignCostRepository(context.database, context.workspace);
    if (!(await repository.hasProject(input.id))) throw errors.PROJECT_NOT_FOUND();
    await repository.remove(input.id, input.costId);
    return ack;
  }),
};
