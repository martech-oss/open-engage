import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { listDeadLetters, replayDeadLetter } from "./dead-letter-service";
import { operationHealth } from "./operation-health-service";

export const listDeadLettersProcedure = authed.platform.listDeadLetters.handler(
  async ({ context, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    return listDeadLetters(context.database, context.workspace.workspaceId);
  },
);

export const replayDeadLetterProcedure = authed.platform.replayDeadLetter.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const outcome = await replayDeadLetter(
      context.database,
      { jobs: context.env.JOBS_QUEUE, delivery: context.env.DELIVERY_QUEUE },
      context.workspace.workspaceId,
      input.id,
    );
    if (outcome.kind === "not_found") throw errors.DEAD_LETTER_NOT_FOUND();
    return ack;
  },
);

export const platformProcedures = {
  operationHealth: authed.platform.operationHealth.handler(({ context, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    return operationHealth(context.database, context.workspace.workspaceId);
  }),
  listDeadLetters: listDeadLettersProcedure,
  replayDeadLetter: replayDeadLetterProcedure,
};
