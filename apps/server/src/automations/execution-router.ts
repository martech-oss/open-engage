import {
  AutomationRunRepository,
  AutomationExecutionRepository,
  AutomationCatalogRepository,
} from "@openengage/database/automations";

import { authed, requireRole } from "../orpc/base";
import { validateSegmentFilter } from "../segments/validation-service";

export const automationExecutionProcedures = {
  listEnrollments: authed.automations.listEnrollments.handler(({ context, input }) =>
    new AutomationExecutionRepository(context.database, context.workspace).listEnrollments(
      input.id,
    ),
  ),
  executionOptions: authed.automations.executionOptions.handler(({ context }) =>
    new AutomationCatalogRepository(context.database, context.workspace).executionOptions(),
  ),
  previewRun: authed.automations.previewRun.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repo = new AutomationRunRepository(context.database, context.workspace);
    try {
      const version = await repo.published(input.id);
      if (version.source.config.audience.kind === "filter") {
        const result = await validateSegmentFilter(
          context.database,
          context.workspace,
          version.source.config.audience.filter,
        );
        if (!result.valid)
          throw new Error(
            result.issues
              .map((issue) => `ノード ${version.source.id} の条件 ${issue.path}: ${issue.message}`)
              .join("; "),
          );
      }
      return { versionId: version.id, ...(await repo.preview(version.source.config.audience)) };
    } catch (error) {
      throw errors.INVALID_AUTOMATION_RUN({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }),
  startRun: authed.automations.startRun.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      const run = await new AutomationRunRepository(context.database, context.workspace).startRun(
        input.id,
        `manual:${input.requestId}`,
        new Date().toISOString(),
        input.versionId,
      );
      context.executionContext.waitUntil(
        context.env.JOBS_QUEUE.send({
          kind: "automation_run",
          workspaceId: context.workspace.workspaceId,
          runId: run.id,
        }),
      );
      return run;
    } catch (error) {
      throw errors.INVALID_AUTOMATION_RUN({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }),
  listRuns: authed.automations.listRuns.handler(({ context, input }) =>
    new AutomationRunRepository(context.database, context.workspace).listRuns(input.id),
  ),
  runDetail: authed.automations.runDetail.handler(async ({ context, input, errors }) => {
    const detail = await new AutomationRunRepository(context.database, context.workspace).runDetail(
      input.runId,
      input.cursor,
    );
    if (!detail || detail.run.automationId !== input.id)
      throw errors.AUTOMATION_EXECUTION_NOT_FOUND();
    return detail;
  }),
  cancelRun: authed.automations.cancelRun.handler(async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repo = new AutomationRunRepository(context.database, context.workspace),
      run = await repo.runVersion(input.runId);
    if (!run || run.automationId !== input.id) throw errors.AUTOMATION_EXECUTION_NOT_FOUND();
    await repo.cancelRun(input.runId);
    return { ok: true as const };
  }),
  enrollmentDetail: authed.automations.enrollmentDetail.handler(
    async ({ context, input, errors }) => {
      const detail = await new AutomationExecutionRepository(
        context.database,
        context.workspace,
      ).enrollmentDetail(input.enrollmentId);
      if (!detail || detail.automationId !== input.id)
        throw errors.AUTOMATION_EXECUTION_NOT_FOUND();
      return detail;
    },
  ),
  cancelEnrollment: authed.automations.cancelEnrollment.handler(
    async ({ context, input, errors }) => {
      requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
      const repo = new AutomationExecutionRepository(context.database, context.workspace),
        detail = await repo.enrollmentDetail(input.enrollmentId);
      if (!detail || detail.automationId !== input.id)
        throw errors.AUTOMATION_EXECUTION_NOT_FOUND();
      await repo.cancelEnrollment(input.enrollmentId);
      return { ok: true as const };
    },
  ),
};
