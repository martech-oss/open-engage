import { landingGenerationJobSchema } from "@openengage/core/web";
import { isConstraintError } from "@openengage/database/shared";
import { LandingDesignRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { landingImageUrls } from "./landing-assets";
import { queueLandingGeneration, retryLandingGeneration } from "./landing-generation-service";
import { publishLandingPage } from "./landing-publication-service";
import { renderLandingPage } from "./landing-renderer";
import { resolveLandingVariablePublication } from "./variable-publication-service";

export const landingDesignProcedures = {
  getPageDesign: authed.website.getPageDesign.handler(async ({ context, input, errors }) => {
    const repository = new LandingDesignRepository(context.database, context.workspace);
    const page = await repository.page(input.id);
    if (!page) throw errors.PAGE_NOT_FOUND();
    const [versions, jobs] = await Promise.all([
      repository.versions(input.id),
      repository.jobs(input.id),
    ]);
    const current = versions.find((version) => version.id === page.currentVersionId);
    let previewDocument = current?.publishedDocument ?? current?.document;
    let variableError: string | null = null;
    if (current && !current.publishedDocument) {
      try {
        previewDocument = (
          await resolveLandingVariablePublication(
            context.database,
            context.workspace.workspaceId,
            current.document,
          )
        ).document;
      } catch (error) {
        variableError = error instanceof Error ? error.message : "変数を解決できませんでした";
      }
    }
    const previewHtml =
      current && previewDocument
        ? await renderLandingPage(previewDocument, {
            origin: context.env.APP_URL,
            workspaceSlug: "",
            pageSlug: page.slug,
            measurementToken: "",
            formBindings: [],
            imageUrls: await landingImageUrls(
              context.database,
              context.workspace.workspaceId,
              current.document,
              context.env.APP_URL,
              true,
            ),
            preview: true,
          })
        : "";
    return {
      name: page.name,
      slug: page.slug,
      versions,
      jobs,
      previewHtml,
      variableError,
      currentVersionId: page.currentVersionId,
      publishedVersionId: page.publishedVersionId,
    };
  }),
  generatePage: authed.website.generatePage.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await queueLandingGeneration(
      context.database,
      context.workspace,
      context.env,
      input,
    );
    switch (outcome.kind) {
      case "not_found":
        throw errors.PAGE_NOT_FOUND();
      case "conflict":
        throw errors.PAGE_CONFLICT();
      case "invalid":
        throw errors.PAGE_INVALID();
      case "ok":
        return landingGenerationJobSchema.parse(outcome.job);
    }
  }),
  retryPageGeneration: authed.website.retryPageGeneration.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      const outcome = await retryLandingGeneration(
        context.database,
        context.workspace,
        context.env,
        input,
      );
      if (outcome === "not_found") throw errors.PAGE_NOT_FOUND();
      if (outcome === "conflict") throw errors.PAGE_CONFLICT();
      return ack;
    },
  ),
  publishPage: authed.website.publishPage.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    let result;
    try {
      result = await publishLandingPage(
        context.database,
        context.workspace.workspaceId,
        context.env,
        input,
      );
    } catch (error) {
      if (isConstraintError(error)) throw errors.PAGE_CONFLICT({ cause: error });
      throw errors.PAGE_INVALID({ cause: error });
    }
    if (result === "not_found") throw errors.PAGE_NOT_FOUND();
    if (result === "conflict") throw errors.PAGE_CONFLICT();
    return ack;
  }),
};
