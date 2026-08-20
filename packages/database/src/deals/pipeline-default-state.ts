import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { defaultDealStages } from "@openengage/core/deals";

import { isConstraintError, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { dealPipelines, dealStages } from "./schema";

export class PipelineDefaultStateRepository extends WorkspaceRepository {
  /**
   * Returns the id of the workspace's default pipeline, creating it (with its
   * five seed stages) in one atomic batch if none exists yet. Tolerant of a
   * concurrent creator: if the batch insert loses a unique-name race, the
   * winner's pipeline is looked up and returned instead of failing.
   */
  public async ensureDefaultPipeline(): Promise<string> {
    const workspaceId = this.context.workspaceId;
    const existing = await this.findDefaultPipeline();
    if (existing) return existing.id;

    const candidate = await this.findOldestActivePipeline();
    if (candidate) {
      await this.promoteDefaultPipeline(candidate.id);
      const repaired = await this.findDefaultPipeline();
      if (repaired) return repaired.id;
    }

    const pipelineId = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    const statements = [
      this.clearDefaultFlag(now),
      orm.insert(dealPipelines).values({
        id: pipelineId,
        workspaceId,
        name: "セールスパイプライン",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      }),
      ...defaultDealStages.map((stage, position) =>
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
    try {
      if (!first) throw new Error("no seed statements");
      await orm.batch([first, ...rest]);
      return pipelineId;
    } catch (error) {
      if (!isConstraintError(error)) throw error;
      const raced = await this.findDefaultPipeline();
      if (raced) return raced.id;
      throw new Error("デフォルトの商談パイプラインを作成できませんでした");
    }
  }

  public async findDefaultPipeline(): Promise<{ id: string } | null> {
    const row = await this.database.orm
      .select({ id: dealPipelines.id })
      .from(dealPipelines)
      .where(
        and(
          this.inWorkspace(dealPipelines),
          isNull(dealPipelines.archivedAt),
          eq(dealPipelines.isDefault, true),
        ),
      )
      .orderBy(asc(dealPipelines.createdAt), asc(dealPipelines.id))
      .limit(1)
      .get();
    return row ?? null;
  }

  public async findOldestActivePipeline(): Promise<{ id: string } | null> {
    const row = await this.database.orm
      .select({ id: dealPipelines.id })
      .from(dealPipelines)
      .where(and(this.inWorkspace(dealPipelines), isNull(dealPipelines.archivedAt)))
      .orderBy(asc(dealPipelines.createdAt), asc(dealPipelines.id))
      .limit(1)
      .get();
    return row ?? null;
  }

  public async repairMissingDefaultPipeline(): Promise<void> {
    if (await this.findDefaultPipeline()) return;
    const candidate = await this.findOldestActivePipeline();
    if (candidate) await this.promoteDefaultPipeline(candidate.id);
  }

  public async promoteDefaultPipeline(id: string): Promise<void> {
    const now = nowIso();
    await this.database.orm.batch([
      this.clearDefaultFlag(now, id, id),
      this.database.orm
        .update(dealPipelines)
        .set({ isDefault: true, updatedAt: now })
        .where(
          and(
            this.inWorkspace(dealPipelines),
            eq(dealPipelines.id, id),
            isNull(dealPipelines.archivedAt),
          ),
        ),
    ]);
  }

  public clearDefaultFlag(now: string, exceptId?: string, requiredActiveId?: string) {
    return this.database.orm
      .update(dealPipelines)
      .set({ isDefault: false, updatedAt: now })
      .where(
        and(
          this.inWorkspace(dealPipelines),
          isNull(dealPipelines.archivedAt),
          ...(exceptId ? [ne(dealPipelines.id, exceptId)] : []),
          requiredActiveId === undefined
            ? undefined
            : sql`EXISTS (
                SELECT 1 FROM deal_pipelines promotion_target
                WHERE promotion_target.workspace_id = ${this.context.workspaceId}
                  AND promotion_target.id = ${requiredActiveId}
                  AND promotion_target.archived_at IS NULL
              )`,
        ),
      );
  }
}
