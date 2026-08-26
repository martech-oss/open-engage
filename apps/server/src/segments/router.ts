import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { resolveApprovedProjectBriefContext } from "../projects/project-brief-context";
import { createSegmentCommandService } from "./command-service";
import { SegmentGenerationError, generateSegment } from "./generation-service";
import { getSegment, listSegments, previewSegment } from "./list-service";
import { loadSegmentCatalog, validateSegmentFilter } from "./validation-service";

export const listSegmentsProcedure = authed.segments.list.handler(async ({ context, input }) => {
  return listSegments(context.database, context.workspace, input.kind);
});

export const segmentOptionsProcedure = authed.segments.options.handler(async ({ context }) =>
  loadSegmentCatalog(context.database, context.workspace),
);

export const getSegmentProcedure = authed.segments.get.handler(
  async ({ context, input, errors }) => {
    const segment = await getSegment(context.database, context.workspace, input.id);
    if (!segment) throw errors.SEGMENT_NOT_FOUND();
    return segment;
  },
);

export const createSegmentProcedure = authed.segments.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createSegmentCommandService({
      database: context.database,
      workspace: context.workspace,
      queue: context.env.JOBS_QUEUE,
      defer: (promise) => context.executionContext.waitUntil(promise),
    }).create(input);
    switch (outcome.kind) {
      case "ok":
        return outcome.segment;
      case "filter_required":
        throw errors.FILTER_REQUIRED();
      case "invalid_segment_filter":
        throw errors.INVALID_SEGMENT_FILTER();
      case "segment_conflict":
        throw errors.SEGMENT_CONFLICT({ cause: outcome.cause });
      case "brief_not_found":
        throw errors.BRIEF_NOT_FOUND();
      case "brief_not_approved":
        throw errors.BRIEF_NOT_APPROVED();
      case "brief_revision_conflict":
        throw errors.BRIEF_REVISION_CONFLICT();
      case "forbidden":
        throw errors.FORBIDDEN();
    }
  },
);

export const updateSegmentProcedure = authed.segments.update.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createSegmentCommandService({
      database: context.database,
      workspace: context.workspace,
      queue: context.env.JOBS_QUEUE,
      defer: (promise) => context.executionContext.waitUntil(promise),
    }).update(input);
    switch (outcome.kind) {
      case "ok":
        return outcome.segment;
      case "invalid_segment_filter":
        throw errors.INVALID_SEGMENT_FILTER();
      case "segment_conflict":
        throw errors.SEGMENT_CONFLICT({ cause: outcome.cause });
      case "segment_not_found":
        throw errors.SEGMENT_NOT_FOUND();
    }
  },
);

export const validateSegmentProcedure = authed.segments.validate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    return validateSegmentFilter(context.database, context.workspace, input.filter);
  },
);

export const generateSegmentProcedure = authed.segments.generate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      const trustedBrief = await resolveApprovedProjectBriefContext(
        context.database,
        context.workspace,
        input,
        errors,
      );
      return await generateSegment(
        context.database,
        context.workspace,
        context.env,
        input,
        trustedBrief,
      );
    } catch (error) {
      if (!(error instanceof SegmentGenerationError)) throw error;
      switch (error.kind) {
        case "failed":
          throw errors.AI_GENERATION_FAILED();
        case "timeout":
          throw errors.AI_GENERATION_TIMEOUT();
        case "unavailable":
          throw errors.AI_GENERATION_UNAVAILABLE();
      }
    }
  },
);

export const refreshSegmentProcedure = authed.segments.refresh.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createSegmentCommandService({
      database: context.database,
      workspace: context.workspace,
      queue: context.env.JOBS_QUEUE,
      defer: (promise) => context.executionContext.waitUntil(promise),
    }).refresh(input.id);
    if (outcome.kind === "segment_not_found") throw errors.SEGMENT_NOT_FOUND();
    return ack;
  },
);

export const previewSegmentProcedure = authed.segments.preview.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const validation = await validateSegmentFilter(
      context.database,
      context.workspace,
      input.filter,
    );
    if (!validation.valid) throw errors.INVALID_SEGMENT_FILTER();
    return previewSegment(context.database, context.workspace, validation.normalized);
  },
);

export const segmentProcedures = {
  list: listSegmentsProcedure,
  options: segmentOptionsProcedure,
  get: getSegmentProcedure,
  create: createSegmentProcedure,
  update: updateSegmentProcedure,
  validate: validateSegmentProcedure,
  generate: generateSegmentProcedure,
  refresh: refreshSegmentProcedure,
  preview: previewSegmentProcedure,
};
