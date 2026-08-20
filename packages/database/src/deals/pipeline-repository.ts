import { and, count, eq, isNull, ne, sql, type SQL } from "drizzle-orm";

import {
  dealPipelineSchema,
  type DealPipeline,
  type DealPipelineCreate,
  type DealPipelineUpdate,
} from "@openengage/core/deals";

import { isConstraintError, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { PipelineDefaultStateRepository } from "./pipeline-default-state";
import { PipelineStageStatementsRepository } from "./pipeline-stage-statements";
import { dealPipelines, deals, dealStages } from "./schema";
import type {
  DealPipelineRow,
  DealStageRow,
  PipelineArchiveResult,
  PipelineCreateResult,
  PipelineUpdateResult,
} from "./types";

export class DealPipelineRepository extends WorkspaceRepository {
  private readonly defaults = new PipelineDefaultStateRepository(this.database, this.context);
  private readonly stages = new PipelineStageStatementsRepository(this.database, this.context);

  /** Canonical API DTO; the row-pair method remains for invariant transitions. */
  public async getPipeline(id: string): Promise<DealPipeline | null> {
    const loaded = await this.getPipelineWithStages(id);
    if (!loaded) return null;
    return dealPipelineSchema.parse({
      id: loaded.pipeline.id,
      name: loaded.pipeline.name,
      isDefault: Boolean(loaded.pipeline.isDefault),
      stages: loaded.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        color: stage.color,
        position: Number(stage.position),
        probability: Number(stage.probability),
      })),
    });
  }

  public async getPipelineWithStages(
    id: string,
  ): Promise<{ pipeline: DealPipelineRow; stages: DealStageRow[] } | null> {
    const pipeline = await this.database.orm
      .select({
        id: dealPipelines.id,
        name: dealPipelines.name,
        isDefault: dealPipelines.isDefault,
      })
      .from(dealPipelines)
      .where(
        and(
          this.inWorkspace(dealPipelines),
          eq(dealPipelines.id, id),
          isNull(dealPipelines.archivedAt),
        ),
      )
      .get();
    if (!pipeline) return null;
    return { pipeline, stages: await this.stages.listPipelineStages(id) };
  }

  public async createPipeline(input: DealPipelineCreate): Promise<PipelineCreateResult> {
    if (await this.activePipelineNameTaken(input.name)) return { kind: "conflict" };

    let existingDefault = await this.defaults.findDefaultPipeline();
    if (!existingDefault) {
      const candidate = await this.defaults.findOldestActivePipeline();
      if (candidate) {
        await this.defaults.promoteDefaultPipeline(candidate.id);
        existingDefault = await this.defaults.findDefaultPipeline();
      }
    }

    const pipelineId = uuidv7();
    const now = nowIso();
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const makeDefault = input.isDefault || !existingDefault;
    const statements = [
      ...(makeDefault ? [this.defaults.clearDefaultFlag(now)] : []),
      orm.insert(dealPipelines).values({
        id: pipelineId,
        workspaceId,
        name: input.name,
        isDefault: makeDefault,
        createdAt: now,
        updatedAt: now,
      }),
      ...input.stages.map((stage, position) =>
        orm.insert(dealStages).values({
          id: uuidv7(),
          workspaceId,
          pipelineId,
          name: stage.name,
          color: stage.color,
          position,
          probability: stage.probability,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ];
    const [first, ...rest] = statements;
    if (!first) throw new Error("no pipeline insert statements");
    try {
      await orm.batch([first, ...rest]);
      return { kind: "ok", id: pipelineId };
    } catch (error) {
      if (isConstraintError(error)) return { kind: "conflict" };
      throw error;
    }
  }

  public async updatePipeline(
    id: string,
    input: DealPipelineUpdate,
  ): Promise<PipelineUpdateResult> {
    const current = await this.getPipelineWithStages(id);
    if (!current) return "not_found";
    if (input.isDefault === false && current.pipeline.isDefault) return "default_required";
    if (input.name && (await this.activePipelineNameTaken(input.name, id))) return "conflict";
    if (input.stages) {
      const incomingIds = new Set(input.stages.flatMap((stage) => (stage.id ? [stage.id] : [])));
      const removed = current.stages.filter((stage) => !incomingIds.has(stage.id));
      if (
        removed.length > 0 &&
        (await this.stages.stagesHaveDeals(removed.map((stage) => stage.id)))
      ) {
        return "stage_in_use";
      }
    }

    const now = nowIso();
    const orm = this.database.orm;
    const statements = [
      ...(input.isDefault === true ? [this.defaults.clearDefaultFlag(now, id, id)] : []),
      orm
        .update(dealPipelines)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isDefault === true ? { isDefault: true } : {}),
          updatedAt: now,
        })
        .where(
          and(
            this.inWorkspace(dealPipelines),
            eq(dealPipelines.id, id),
            isNull(dealPipelines.archivedAt),
          ),
        ),
      ...(input.stages
        ? this.stages.replaceStageStatements(id, current.stages, input.stages, now)
        : []),
    ];
    const [first, ...rest] = statements;
    if (!first) return "ok";
    try {
      await orm.batch([first, ...rest]);
      return "ok";
    } catch (error) {
      if (isConstraintError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        if (/deal_stages/i.test(message)) return "stage_in_use";
        return "conflict";
      }
      throw error;
    }
  }

  public async archivePipeline(id: string): Promise<PipelineArchiveResult> {
    await this.defaults.repairMissingDefaultPipeline();
    const current = await this.getPipelineWithStages(id);
    if (!current) return "not_found";
    if ((await this.countActivePipelines()) <= 1) return "last";
    if ((await this.countPipelineDeals(id)) > 0) return "in_use";

    const now = nowIso();
    const suffix = ` [archived ${id.slice(0, 8)}]`;
    const archivedName = `${current.pipeline.name.slice(0, Math.max(0, 191 - suffix.length))}${suffix}`;
    const statements = [
      this.database.orm
        .update(dealPipelines)
        .set({
          name: archivedName,
          isDefault: false,
          archivedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            this.inWorkspace(dealPipelines),
            eq(dealPipelines.id, id),
            isNull(dealPipelines.archivedAt),
            this.anotherActivePipelineExists(id),
            this.noActivePipelineDeals(id),
          ),
        ),
      this.database.orm
        .update(dealPipelines)
        .set({ isDefault: true, updatedAt: now })
        .where(
          and(
            this.inWorkspace(dealPipelines),
            isNull(dealPipelines.archivedAt),
            eq(
              dealPipelines.id,
              sql<string>`(
                SELECT fallback.id
                FROM deal_pipelines fallback
                WHERE fallback.workspace_id = ${this.context.workspaceId}
                  AND fallback.archived_at IS NULL
                ORDER BY fallback.created_at, fallback.id
                LIMIT 1
              )`,
            ),
            sql`NOT EXISTS (
              SELECT 1 FROM deal_pipelines active_default
              WHERE active_default.workspace_id = ${this.context.workspaceId}
                AND active_default.archived_at IS NULL
                AND active_default.is_default = 1
            )`,
            sql`EXISTS (
              SELECT 1 FROM deal_pipelines archived_target
              WHERE archived_target.workspace_id = ${this.context.workspaceId}
                AND archived_target.id = ${id}
                AND archived_target.archived_at = ${now}
            )`,
          ),
        ),
    ];
    const [first, ...rest] = statements;
    if (!first) return "not_found";
    const [archiveResult] = await this.database.orm.batch([first, ...rest]);
    if (archiveResult.meta.changes !== 1) {
      if ((await this.countActivePipelines()) <= 1) return "last";
      if ((await this.countPipelineDeals(id)) > 0) return "in_use";
      return "not_found";
    }
    return "ok";
  }

  private async activePipelineNameTaken(name: string, exceptId?: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: dealPipelines.id })
      .from(dealPipelines)
      .where(
        and(
          this.inWorkspace(dealPipelines),
          eq(dealPipelines.name, name),
          isNull(dealPipelines.archivedAt),
          ...(exceptId ? [ne(dealPipelines.id, exceptId)] : []),
        ),
      )
      .get();
    return row !== undefined;
  }

  private async countActivePipelines(): Promise<number> {
    const row = await this.database.orm
      .select({ value: count().as("value") })
      .from(dealPipelines)
      .where(and(this.inWorkspace(dealPipelines), isNull(dealPipelines.archivedAt)))
      .get();
    return Number(row?.value ?? 0);
  }

  private async countPipelineDeals(pipelineId: string): Promise<number> {
    const row = await this.database.orm
      .select({ value: count().as("value") })
      .from(deals)
      .where(
        and(this.inWorkspace(deals), eq(deals.pipelineId, pipelineId), isNull(deals.archivedAt)),
      )
      .get();
    return Number(row?.value ?? 0);
  }

  private anotherActivePipelineExists(id: string): SQL {
    return sql`EXISTS (
      SELECT 1 FROM deal_pipelines archive_fallback
      WHERE archive_fallback.workspace_id = ${this.context.workspaceId}
        AND archive_fallback.id != ${id}
        AND archive_fallback.archived_at IS NULL
    )`;
  }

  private noActivePipelineDeals(id: string): SQL {
    return sql`NOT EXISTS (
      SELECT 1 FROM deals pipeline_deals
      WHERE pipeline_deals.workspace_id = ${this.context.workspaceId}
        AND pipeline_deals.pipeline_id = ${id}
        AND pipeline_deals.archived_at IS NULL
    )`;
  }
}
