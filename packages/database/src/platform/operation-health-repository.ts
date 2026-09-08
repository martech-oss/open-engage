import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";

import type { OperationIssue } from "@openengage/core/platform";

import {
  automations,
  automationEnrollments,
  automationJobs,
  automationRuns,
  automationRunTargets,
  automationVersions,
} from "../automations/schema";
import { projectCloneJobs } from "../projects/clone-schema";
import { WorkspaceRepository } from "../shared/repository-base";

export class OperationHealthRepository extends WorkspaceRepository {
  public async failures(): Promise<OperationIssue[]> {
    const orm = this.database.orm;
    const [clones, runs, calls] = await Promise.all([
      orm
        .select()
        .from(projectCloneJobs)
        .where(and(this.inWorkspace(projectCloneJobs), eq(projectCloneJobs.status, "failed")))
        .orderBy(desc(projectCloneJobs.updatedAt))
        .limit(50),
      orm
        .select({
          run: automationRuns,
          name: automations.name,
          targetError: sql<
            string | null
          >`(SELECT last_error FROM ${automationRunTargets} WHERE run_id=${automationRuns.id} AND workspace_id=${this.context.workspaceId} AND status='failed' LIMIT 1)`,
        })
        .from(automationRuns)
        .innerJoin(
          automations,
          and(
            eq(automations.id, automationRuns.automationId),
            eq(automations.workspaceId, automationRuns.workspaceId),
          ),
        )
        .where(
          and(
            this.inWorkspace(automationRuns),
            or(
              eq(automationRuns.status, "failed"),
              sql`EXISTS(SELECT 1 FROM ${automationRunTargets} WHERE run_id=${automationRuns.id} AND workspace_id=${this.context.workspaceId} AND status='failed')`,
            ),
          ),
        )
        .orderBy(desc(automationRuns.updatedAt))
        .limit(50),
      orm
        .select({
          enrollment: automationEnrollments,
          name: automations.name,
          error: sql<
            string | null
          >`(SELECT last_error FROM ${automationJobs} WHERE enrollment_id=${automationEnrollments.id} AND workspace_id=${this.context.workspaceId} AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1)`,
        })
        .from(automationEnrollments)
        .innerJoin(
          automations,
          and(
            eq(automations.id, automationEnrollments.automationId),
            eq(automations.workspaceId, automationEnrollments.workspaceId),
          ),
        )
        .where(
          and(
            this.inWorkspace(automationEnrollments),
            eq(automationEnrollments.status, "failed"),
            isNotNull(automationEnrollments.parentJobId),
          ),
        )
        .orderBy(desc(automationEnrollments.updatedAt))
        .limit(50),
    ]);
    return [
      ...clones.map(
        (job): OperationIssue => ({
          id: job.id,
          kind: "clone_failure",
          name: String((JSON.parse(job.options) as { name: string }).name),
          message: job.error ?? "複製に失敗しました",
          occurredAt: job.updatedAt,
          projectId: job.sourceProjectId,
          automationId: null,
          runId: null,
          enrollmentId: null,
        }),
      ),
      ...runs.map(
        ({ run, name, targetError }): OperationIssue => ({
          id: run.id,
          kind: "batch_failure",
          name,
          message: run.lastError ?? targetError ?? "バッチ登録に失敗した対象者がいます",
          occurredAt: run.updatedAt,
          projectId: null,
          automationId: run.automationId,
          runId: run.id,
          enrollmentId: null,
        }),
      ),
      ...calls.map(
        ({ enrollment, name, error }): OperationIssue => ({
          id: enrollment.id,
          kind: "call_failure",
          name,
          message: error ?? "共通処理に失敗しました",
          occurredAt: enrollment.updatedAt,
          projectId: enrollment.projectId,
          automationId: enrollment.automationId,
          runId: null,
          enrollmentId: enrollment.id,
        }),
      ),
    ];
  }

  public async schedules() {
    return this.database.orm
      .select({
        id: automations.id,
        name: automations.name,
        graph: automationVersions.graph,
        publishedAt: automationVersions.publishedAt,
        lastSlot: sql<
          string | null
        >`(SELECT MAX(slot) FROM ${automationRuns} WHERE automation_id=${automations.id} AND workspace_id=${this.context.workspaceId} AND slot NOT LIKE 'manual:%')`,
      })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.publishedVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(
        and(
          this.inWorkspace(automations),
          eq(automations.status, "active"),
          sql`EXISTS(SELECT 1 FROM json_each(${automationVersions.graph},'$.nodes') n WHERE json_extract(n.value,'$.config.source')='batch')`,
        ),
      )
      .limit(200);
  }
}
