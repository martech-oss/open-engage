import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { type DealPipelineUpdate } from "@openengage/core/deals";

import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { deals, dealStages } from "./schema";
import type { DealStageRow } from "./types";

export class PipelineStageStatementsRepository extends WorkspaceRepository {
  public async listPipelineStages(pipelineId: string): Promise<DealStageRow[]> {
    return this.database.orm
      .select({
        id: dealStages.id,
        pipelineId: dealStages.pipelineId,
        name: dealStages.name,
        color: dealStages.color,
        position: dealStages.position,
        probability: dealStages.probability,
      })
      .from(dealStages)
      .where(and(this.inWorkspace(dealStages), eq(dealStages.pipelineId, pipelineId)))
      .orderBy(asc(dealStages.position))
      .all();
  }

  public async stagesHaveDeals(stageIds: string[]): Promise<boolean> {
    if (stageIds.length === 0) return false;
    const row = await this.database.orm
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(this.inWorkspace(deals), inArray(deals.stageId, stageIds), isNull(deals.archivedAt)),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }

  public replaceStageStatements(
    pipelineId: string,
    current: DealStageRow[],
    stages: NonNullable<DealPipelineUpdate["stages"]>,
    now: string,
  ) {
    const workspaceId = this.context.workspaceId;
    const currentIds = new Set(current.map((stage) => stage.id));
    const incomingIds = new Set(stages.flatMap((stage) => (stage.id ? [stage.id] : [])));
    const removed = current.filter((stage) => !incomingIds.has(stage.id));
    const orm = this.database.orm;
    return [
      ...(current.length > 0
        ? [
            orm
              .update(dealStages)
              .set({ position: sql`${dealStages.position} + 1000`, updatedAt: now })
              .where(and(this.inWorkspace(dealStages), eq(dealStages.pipelineId, pipelineId))),
          ]
        : []),
      ...stages.map((stage, position) =>
        stage.id && currentIds.has(stage.id)
          ? orm
              .update(dealStages)
              .set({
                name: stage.name,
                color: stage.color,
                probability: stage.probability,
                position,
                updatedAt: now,
              })
              .where(and(this.inWorkspace(dealStages), eq(dealStages.id, stage.id)))
          : orm.insert(dealStages).values({
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
      ...removed.map((stage) =>
        orm
          .delete(dealStages)
          .where(and(this.inWorkspace(dealStages), eq(dealStages.id, stage.id))),
      ),
    ];
  }
}
