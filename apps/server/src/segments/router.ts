import { SegmentRepository, writeAuditLog } from "@openengage/database";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { SegmentGenerationError, generateSegment } from "./generation-service";
import { listSegments, previewSegment, toSegmentRow } from "./list-service";
import { refreshSegmentMemberships } from "./membership-service";
import { loadSegmentCatalog, validateSegmentFilter } from "./validation-service";

export const listSegmentsProcedure = authed.segments.list.handler(async ({ context }) => {
  return listSegments(context.database, context.workspace);
});

export const segmentOptionsProcedure = authed.segments.options.handler(async ({ context }) =>
  loadSegmentCatalog(context.database, context.workspace),
);

export const getSegmentProcedure = authed.segments.get.handler(
  async ({ context, input, errors }) => {
    const segment = await new SegmentRepository(context.database, context.workspace).getSegment(
      input.id,
    );
    if (!segment) throw errors.SEGMENT_NOT_FOUND();
    return toSegmentRow(segment);
  },
);

export const createSegmentProcedure = authed.segments.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (input.kind === "dynamic" && !input.filter) throw errors.FILTER_REQUIRED();
    if (input.kind === "dynamic" && input.filter) {
      const validation = await validateSegmentFilter(
        context.database,
        context.workspace,
        input.filter,
      );
      if (!validation.valid) throw errors.INVALID_SEGMENT_FILTER();
    }
    const repository = new SegmentRepository(context.database, context.workspace);
    let created: Awaited<ReturnType<typeof repository.createSegment>>;
    try {
      created = await repository.createSegment({
        ...input,
        membershipSource:
          input.kind === "static" ? (input.membershipSource ?? "Manual selection") : null,
      });
    } catch (error) {
      throw errors.SEGMENT_CONFLICT({ cause: error });
    }
    if (input.kind === "dynamic") {
      await refreshSegmentMemberships(
        context.database,
        context.workspace.workspaceId,
        created.id,
        1,
      );
    }
    context.executionContext.waitUntil(
      writeAuditLog(context.database, context.workspace, {
        action: "segment.create",
        resourceType: "segment",
        resourceId: created.id,
      }),
    );
    return {
      id: created.id,
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  },
);

export const updateSegmentProcedure = authed.segments.update.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (input.kind === "dynamic" && input.filter) {
      const validation = await validateSegmentFilter(
        context.database,
        context.workspace,
        input.filter,
      );
      if (!validation.valid) throw errors.INVALID_SEGMENT_FILTER();
    }
    const { id, filter, ...definition } = input;
    const repository = new SegmentRepository(context.database, context.workspace);
    let updated: Awaited<ReturnType<typeof repository.updateSegment>>;
    try {
      updated = await repository.updateSegment(id, {
        ...definition,
        ...(filter ? { filter } : {}),
      });
    } catch (error) {
      throw errors.SEGMENT_CONFLICT({ cause: error });
    }
    if (!updated) throw errors.SEGMENT_NOT_FOUND();
    if (input.kind === "dynamic") {
      await context.env.JOBS_QUEUE.send({
        kind: "segment_full_refresh",
        workspaceId: context.workspace.workspaceId,
        segmentId: id,
        filterVersion: updated.filterVersion,
      });
    }
    context.executionContext.waitUntil(
      writeAuditLog(context.database, context.workspace, {
        action: "segment.update",
        resourceType: "segment",
        resourceId: id,
      }),
    );
    return updated;
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
      return await generateSegment(context.database, context.workspace, context.env, input);
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
    const repository = new SegmentRepository(context.database, context.workspace);
    const definition = await repository.findSegmentDefinition(input.id);
    if (!definition) throw errors.SEGMENT_NOT_FOUND();
    await repository.setEvaluationState(input.id, "pending");
    await context.env.JOBS_QUEUE.send({
      kind: "segment_full_refresh",
      workspaceId: context.workspace.workspaceId,
      segmentId: input.id,
      filterVersion: definition.filterVersion,
    });
    context.executionContext.waitUntil(
      writeAuditLog(context.database, context.workspace, {
        action: "segment.refresh",
        resourceType: "segment",
        resourceId: input.id,
      }),
    );
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
