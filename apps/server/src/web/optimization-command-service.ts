import type { WorkspaceContext } from "@openengage/core/shared";
import { workspaceReportDateRange } from "@openengage/core/shared";
import type { DynamicContentWrite, Experiment, ExperimentWrite } from "@openengage/core/web";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { isConstraintError } from "@openengage/database/shared";
import { LandingDesignRepository, OptimizationRepository } from "@openengage/database/web";
import { WorkspaceSettingsRepository } from "@openengage/database/workspaces";

import type { RuntimeEnv } from "../env";
import { validateLandingReferences } from "./landing-reference-validation";
import { sanitizeLandingHtml } from "./landing-safety";

export type OptimizationOutcome =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "invalid" }
  | { kind: "conflict" };

const ok: OptimizationOutcome = { kind: "ok" };

/** Experiment and dynamic-content writes on a landing page; routers map the outcomes to contract errors. */
export class OptimizationCommandService {
  private readonly experiments: OptimizationRepository;
  private readonly pages: LandingDesignRepository;

  public constructor(
    private readonly database: OpenEngageDatabase,
    private readonly workspace: WorkspaceContext,
    private readonly env: RuntimeEnv,
  ) {
    this.experiments = new OptimizationRepository(database, workspace);
    this.pages = new LandingDesignRepository(database, workspace);
  }

  public async createExperiment(input: ExperimentWrite): Promise<OptimizationOutcome> {
    if (!(await this.pages.page(input.pageId))) return { kind: "not_found" };
    for (const variant of input.variants) {
      if (!(await this.pages.version(input.pageId, variant.pageVersionId))?.publishedAt) {
        return { kind: "invalid" };
      }
    }
    return (await this.experiments.createExperiment(input)) ? ok : { kind: "conflict" };
  }

  public async startExperiment(id: string): Promise<OptimizationOutcome> {
    const experiment = await this.experiments.experiment(id);
    if (!experiment) return { kind: "not_found" };
    const page = await this.pages.page(experiment.pageId);
    if (page?.status !== "published" || !page.publishedVersionId) return { kind: "invalid" };
    for (const variant of experiment.variants) {
      if (!(await this.isServableVariant(experiment, variant.pageVersionId))) {
        return { kind: "invalid" };
      }
    }
    return this.guardConflict(() => this.experiments.start(id));
  }

  public async endExperiment(input: {
    id: string;
    winnerVariantId: string | null;
    expectedPublishedVersionId: string;
  }): Promise<OptimizationOutcome> {
    const experiment = await this.experiments.experiment(input.id);
    if (!experiment) return { kind: "not_found" };
    if (input.winnerVariantId) {
      const winner = experiment.variants.find((variant) => variant.id === input.winnerVariantId);
      if (!winner || !(await this.isServableVariant(experiment, winner.pageVersionId))) {
        return { kind: "invalid" };
      }
    }
    return this.guardConflict(() =>
      this.experiments.end(input.id, input.winnerVariantId, input.expectedPublishedVersionId),
    );
  }

  public async report(input: { id: string; from: string; to: string }) {
    const experiment = await this.experiments.experiment(input.id);
    if (!experiment) return null;
    const workspace = await new WorkspaceSettingsRepository(
      this.database,
      this.workspace,
    ).getWorkspace();
    if (!workspace) throw new Error("Workspace organization could not be loaded");
    const asOf = new Date().toISOString();
    const cohorts = await this.experiments.report(
      input.id,
      workspaceReportDateRange(input.from, input.to, workspace.timezone),
      asOf,
    );
    return {
      experimentId: input.id,
      asOf,
      from: input.from,
      to: input.to,
      cohorts,
      variants: summarizeVariants(experiment.variants, cohorts),
    };
  }

  public async saveDynamicContent(input: DynamicContentWrite): Promise<OptimizationOutcome> {
    const page = await this.pages.page(input.pageId);
    const version = page?.currentVersionId
      ? await this.pages.version(input.pageId, page.currentVersionId)
      : null;
    if (!version?.document.dynamicSlots.some((slot) => slot.refId === input.slotId)) {
      return { kind: "invalid" };
    }
    for (const rule of input.rules) {
      if (!(await this.experiments.validSegment(rule.segmentId))) return { kind: "invalid" };
    }
    await this.experiments.saveDynamic({
      ...input,
      fallbackHtml: await sanitizeLandingHtml(input.fallbackHtml),
      rules: await Promise.all(
        input.rules.map(async (rule) => ({ ...rule, html: await sanitizeLandingHtml(rule.html) })),
      ),
    });
    return ok;
  }

  /** A variant can serve traffic only from a published version whose references all resolve. */
  private async isServableVariant(experiment: Experiment, pageVersionId: string): Promise<boolean> {
    const version = await this.pages.version(experiment.pageId, pageVersionId);
    if (!version?.publishedAt) return false;
    try {
      await validateLandingReferences(
        this.database,
        this.workspace.workspaceId,
        version.document,
        this.env,
        true,
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Starting or ending races other writers; any guard failure means the state moved on. */
  private async guardConflict(write: () => Promise<boolean>): Promise<OptimizationOutcome> {
    try {
      return (await write()) ? ok : { kind: "conflict" };
    } catch (error) {
      if (isConstraintError(error)) return { kind: "conflict" };
      throw error;
    }
  }
}

function summarizeVariants(
  variants: Experiment["variants"],
  cohorts: Awaited<ReturnType<OptimizationRepository["report"]>>,
) {
  return variants.map((variant) => {
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
  });
}
