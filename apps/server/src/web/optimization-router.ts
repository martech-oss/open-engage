import { LandingDesignRepository, OptimizationRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import {
  type OptimizationOutcome,
  OptimizationCommandService,
} from "./optimization-command-service";

interface OptimizationErrors {
  OPTIMIZATION_NOT_FOUND: () => Error;
  OPTIMIZATION_INVALID: () => Error;
  OPTIMIZATION_CONFLICT: () => Error;
}

function ackOrThrow(outcome: OptimizationOutcome, errors: OptimizationErrors) {
  switch (outcome.kind) {
    case "ok":
      return ack;
    case "not_found":
      throw errors.OPTIMIZATION_NOT_FOUND();
    case "invalid":
      throw errors.OPTIMIZATION_INVALID();
    case "conflict":
      throw errors.OPTIMIZATION_CONFLICT();
  }
}

export const optimizationProcedures = {
  listExperiments: authed.website.listExperiments.handler(async ({ context, input, errors }) => {
    if (
      !(await new LandingDesignRepository(context.database, context.workspace).page(input.pageId))
    )
      throw errors.OPTIMIZATION_NOT_FOUND();
    return new OptimizationRepository(context.database, context.workspace).experiments(
      input.pageId,
    );
  }),
  createExperiment: authed.website.createExperiment.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const service = new OptimizationCommandService(
      context.database,
      context.workspace,
      context.env,
    );
    return ackOrThrow(await service.createExperiment(input), errors);
  }),
  startExperiment: authed.website.startExperiment.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const service = new OptimizationCommandService(
      context.database,
      context.workspace,
      context.env,
    );
    return ackOrThrow(await service.startExperiment(input.id), errors);
  }),
  endExperiment: authed.website.endExperiment.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const service = new OptimizationCommandService(
      context.database,
      context.workspace,
      context.env,
    );
    return ackOrThrow(await service.endExperiment(input), errors);
  }),
  experimentReport: authed.website.experimentReport.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const service = new OptimizationCommandService(
      context.database,
      context.workspace,
      context.env,
    );
    const report = await service.report(input);
    if (!report) throw errors.OPTIMIZATION_NOT_FOUND();
    return report;
  }),
  listDynamicContent: authed.website.listDynamicContent.handler(
    async ({ context, input, errors }) => {
      if (
        !(await new LandingDesignRepository(context.database, context.workspace).page(input.pageId))
      )
        throw errors.OPTIMIZATION_NOT_FOUND();
      return new OptimizationRepository(context.database, context.workspace).dynamic(input.pageId);
    },
  ),
  saveDynamicContent: authed.website.saveDynamicContent.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      const service = new OptimizationCommandService(
        context.database,
        context.workspace,
        context.env,
      );
      return ackOrThrow(await service.saveDynamicContent(input), errors);
    },
  ),
};
