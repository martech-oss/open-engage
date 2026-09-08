import { workspaceReportDateRange } from "@openengage/core/shared";
import { isConstraintError } from "@openengage/database/shared";
import { LandingDesignRepository, OptimizationRepository } from "@openengage/database/web";
import { WorkspaceSettingsRepository } from "@openengage/database/workspaces";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { validateLandingReferences } from "./landing-design-service";
import { sanitizeLandingHtml } from "./landing-safety";

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
    const pages = new LandingDesignRepository(context.database, context.workspace);
    if (!(await pages.page(input.pageId))) throw errors.OPTIMIZATION_NOT_FOUND();
    for (const variant of input.variants) {
      if (!(await pages.version(input.pageId, variant.pageVersionId))?.publishedAt)
        throw errors.OPTIMIZATION_INVALID();
    }
    if (
      !(await new OptimizationRepository(context.database, context.workspace).createExperiment(
        input,
      ))
    )
      throw errors.OPTIMIZATION_CONFLICT();
    return ack;
  }),
  startExperiment: authed.website.startExperiment.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new OptimizationRepository(context.database, context.workspace),
      pages = new LandingDesignRepository(context.database, context.workspace);
    const experiment = await repository.experiment(input.id);
    if (!experiment) throw errors.OPTIMIZATION_NOT_FOUND();
    const page = await pages.page(experiment.pageId);
    if (page?.status !== "published" || !page.publishedVersionId)
      throw errors.OPTIMIZATION_INVALID();
    for (const variant of experiment.variants) {
      const version = await pages.version(experiment.pageId, variant.pageVersionId);
      if (!version?.publishedAt) throw errors.OPTIMIZATION_INVALID();
      try {
        await validateLandingReferences(
          context.database,
          context.workspace.workspaceId,
          version.document,
          context.env,
          true,
        );
      } catch {
        throw errors.OPTIMIZATION_INVALID();
      }
    }
    try {
      if (!(await repository.start(input.id))) throw errors.OPTIMIZATION_CONFLICT();
    } catch (error) {
      if (isConstraintError(error)) throw errors.OPTIMIZATION_CONFLICT();
      throw error;
    }
    return ack;
  }),
  endExperiment: authed.website.endExperiment.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new OptimizationRepository(context.database, context.workspace);
    const experiment = await repository.experiment(input.id);
    if (!experiment) throw errors.OPTIMIZATION_NOT_FOUND();
    if (input.winnerVariantId) {
      const winner = experiment.variants.find((variant) => variant.id === input.winnerVariantId);
      const version = winner
        ? await new LandingDesignRepository(context.database, context.workspace).version(
            experiment.pageId,
            winner.pageVersionId,
          )
        : null;
      if (!version?.publishedAt) throw errors.OPTIMIZATION_INVALID();
      try {
        await validateLandingReferences(
          context.database,
          context.workspace.workspaceId,
          version.document,
          context.env,
          true,
        );
      } catch {
        throw errors.OPTIMIZATION_INVALID();
      }
    }
    try {
      if (
        !(await repository.end(input.id, input.winnerVariantId, input.expectedPublishedVersionId))
      )
        throw errors.OPTIMIZATION_CONFLICT();
    } catch (error) {
      if (isConstraintError(error)) throw errors.OPTIMIZATION_CONFLICT();
      throw error;
    }
    return ack;
  }),
  experimentReport: authed.website.experimentReport.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const repository = new OptimizationRepository(context.database, context.workspace),
      experiment = await repository.experiment(input.id);
    if (!experiment) throw errors.OPTIMIZATION_NOT_FOUND();
    const workspace = await new WorkspaceSettingsRepository(
      context.database,
      context.workspace,
    ).getWorkspace();
    const asOf = new Date().toISOString(),
      cohorts = await repository.report(
        input.id,
        workspaceReportDateRange(input.from, input.to, workspace!.timezone),
        asOf,
      );
    return {
      experimentId: input.id,
      asOf,
      from: input.from,
      to: input.to,
      cohorts,
      variants: experiment.variants.map((variant) => {
        const total = cohorts
          .filter((row) => row.variantId === variant.id)
          .reduce(
            (sum, row) => ({
              visitors: sum.visitors + row.visitors,
              conversions: sum.conversions + row.conversions,
              pendingVisitors: sum.pendingVisitors + row.pendingVisitors,
            }),
            { visitors: 0, conversions: 0, pendingVisitors: 0 },
          );
        return {
          variantId: variant.id,
          name: variant.name,
          ...total,
          conversionRate: total.visitors
            ? Math.round((total.conversions / total.visitors) * 10000) / 100
            : 0,
        };
      }),
    };
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
      const pages = new LandingDesignRepository(context.database, context.workspace),
        repository = new OptimizationRepository(context.database, context.workspace);
      const page = await pages.page(input.pageId),
        version = page?.currentVersionId
          ? await pages.version(input.pageId, page.currentVersionId)
          : null;
      if (!version?.document.dynamicSlots.some((slot) => slot.refId === input.slotId))
        throw errors.OPTIMIZATION_INVALID();
      for (const rule of input.rules) {
        if (!(await repository.validSegment(rule.segmentId))) throw errors.OPTIMIZATION_INVALID();
      }
      await repository.saveDynamic({
        ...input,
        fallbackHtml: await sanitizeLandingHtml(input.fallbackHtml),
        rules: await Promise.all(
          input.rules.map(async (rule) => ({
            ...rule,
            html: await sanitizeLandingHtml(rule.html),
          })),
        ),
      });
      return ack;
    },
  ),
};
