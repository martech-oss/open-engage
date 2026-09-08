import { ZodError } from "zod";

import { VariableResolutionError } from "@openengage/core/projects";
import { hasWorkspaceRole } from "@openengage/core/shared";
import { writeAuditLog } from "@openengage/database/platform";
import { VariableRepository, VariableRepositoryError } from "@openengage/database/projects";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { listVariableUses, previewVariableImpact } from "./variable-service";
interface VariableErrors {
  VARIABLE_INVALID: () => Error;
  VARIABLE_CONFLICT: () => Error;
  PROJECT_NOT_FOUND: () => Error;
}
function rethrow(error: unknown, errors: VariableErrors): never {
  if (error instanceof VariableRepositoryError) {
    if (error.kind === "conflict") throw errors.VARIABLE_CONFLICT();
    if (error.kind === "project") throw errors.PROJECT_NOT_FOUND();
    throw errors.VARIABLE_INVALID();
  }
  if (error instanceof VariableResolutionError || error instanceof ZodError)
    throw errors.VARIABLE_INVALID();
  throw error;
}
export const variableProcedures = {
  variablesList: authed.projects.variablesList.handler(async ({ context, input, errors }) => {
    try {
      const repository = new VariableRepository(context.database, context.workspace);
      return {
        definitions: await repository.list(input.projectId),
        effective: await repository.resolve(input.projectId),
        canEdit: hasWorkspaceRole(context.workspace.role, "marketer"),
      };
    } catch (error) {
      rethrow(error, errors);
    }
  }),
  variablesSave: authed.projects.variablesSave.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      const value = await new VariableRepository(context.database, context.workspace).save(input);
      await writeAuditLog(context.database, context.workspace, {
        action: "project.variable.save",
        resourceType: "project_variable",
        resourceId: value.id,
        metadata: { key: value.key, projectId: value.projectId, revision: value.revision },
      });
      return value;
    } catch (error) {
      rethrow(error, errors);
    }
  }),
  variablesDelete: authed.projects.variablesDelete.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await new VariableRepository(context.database, context.workspace).remove(input);
      await writeAuditLog(context.database, context.workspace, {
        action: "project.variable.delete",
        resourceType: "project_variable",
        metadata: { key: input.key, projectId: input.projectId },
      });
      return ack;
    } catch (error) {
      rethrow(error, errors);
    }
  }),
  variablesUses: authed.projects.variablesUses.handler(async ({ context, input, errors }) => {
    try {
      return await listVariableUses(context.database, context.workspace.workspaceId, input);
    } catch (error) {
      rethrow(error, errors);
    }
  }),
  variablesImpact: authed.projects.variablesImpact.handler(async ({ context, input, errors }) => {
    try {
      return await previewVariableImpact(context.database, context.workspace.workspaceId, input);
    } catch (error) {
      rethrow(error, errors);
    }
  }),
};
