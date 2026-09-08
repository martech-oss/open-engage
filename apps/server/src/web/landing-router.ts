import { landingGenerationJobSchema } from "@openengage/core/web";
import { isConstraintError } from "@openengage/database/shared";
import { LandingDesignRepository } from "@openengage/database/web";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { landingImageUrls } from "./landing-assets";
import { publishLandingPage } from "./landing-design-service";
import { renderLandingPage } from "./landing-renderer";

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
    const previewHtml = current
      ? await renderLandingPage(current.document, {
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
      currentVersionId: page.currentVersionId,
      publishedVersionId: page.publishedVersionId,
    };
  }),
  generatePage: authed.website.generatePage.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new LandingDesignRepository(context.database, context.workspace);
    const page = await repository.page(input.pageId);
    if (!page) throw errors.PAGE_NOT_FOUND();
    if (page.currentVersionId !== input.baseVersionId) throw errors.PAGE_CONFLICT();
    const job = await repository.queue({ ...input, userId: context.workspace.userId });
    if (!job) throw errors.PAGE_INVALID();
    if (job.prompt !== input.prompt || job.baseVersionId !== input.baseVersionId)
      throw errors.PAGE_CONFLICT();
    // A durable queued row is authoritative. Scheduled recovery covers queue publication failures.
    try {
      await context.env.JOBS_QUEUE.send({ kind: "landing_generation", jobId: job.id });
    } catch {
      /* recovered on the next scheduled run */
    }
    return landingGenerationJobSchema.parse(job);
  }),
  retryPageGeneration: authed.website.retryPageGeneration.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      const repository = new LandingDesignRepository(context.database, context.workspace);
      if (!(await repository.page(input.pageId))) throw errors.PAGE_NOT_FOUND();
      if (!(await repository.retryGeneration(input.pageId, input.jobId, context.workspace.userId)))
        throw errors.PAGE_CONFLICT();
      try {
        await context.env.JOBS_QUEUE.send({ kind: "landing_generation", jobId: input.jobId });
      } catch {
        /* The persisted queued state is retried by scheduled recovery. */
      }
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
