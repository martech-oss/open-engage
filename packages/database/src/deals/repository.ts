import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  min,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  dealSummarySchema,
  dealTaskListItemSchema,
  dealTaskSchema,
  defaultDealStages,
  type DealCreate,
  type DealPipelineCreate,
  type DealPipelineUpdate,
  type DealSummary,
  type DealTask,
  type DealTaskCreate,
  type DealTaskListItem,
  type DealTaskStatus,
  type DealTaskType,
} from "@openengage/core/deals";

import { member, user } from "../auth/schema";
import { companies, contacts } from "../contacts/schema";
import {
  didChange,
  ensureLoaded,
  isConstraintError,
  likeContains,
  nowIso,
} from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { dealPipelines, dealStages, deals, dealTasks } from "./schema";

/** Cap on the contact/company option lists offered when assigning a deal. */
const DEAL_OPTION_LIST_LIMIT = 500;

export type PipelineCreateResult = { kind: "conflict" } | { kind: "ok"; id: string };
export type PipelineUpdateResult = "not_found" | "conflict" | "stage_in_use" | "ok";
export type PipelineArchiveResult = "not_found" | "last" | "in_use" | "ok";

/**
 * One deal row joined with its pipeline/stage/owner/contact/company names and
 * open-task counters. Repository rows use the same camelCase business shape
 * exposed by core.
 */
export type DealRow = DealSummary;

export type DealTaskRow = DealTask;
export type DealTaskListItemRow = DealTaskListItem;

export interface DealListSummaryRow {
  openCount: number;
  openValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
}

export interface DealPipelineRow {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface DealStageRow {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  position: number;
  probability: number;
}

export interface DealContactOptionRow {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface DealCompanyOptionRow {
  id: string;
  name: string;
  domain: string | null;
}

export interface DealMemberOptionRow {
  id: string;
  name: string;
  email: string;
}

export interface DealOptionRows {
  pipelines: DealPipelineRow[];
  stages: DealStageRow[];
  contacts: DealContactOptionRow[];
  companies: DealCompanyOptionRow[];
  members: DealMemberOptionRow[];
}

/**
 * Deals CRM: pipelines, stages, deals and their tasks.
 *
 * Scoped by workspace id only (not the full {@link WorkspaceContext}), because
 * some call sites only resolve a workspace id. A full context is assignable
 * wherever this scope is expected.
 */
export class DealRepository extends WorkspaceRepository {
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

    const pipelineId = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    const statements = [
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
    } catch {
      const raced = await this.findDefaultPipeline();
      if (raced) return raced.id;
      throw new Error("デフォルトの商談パイプラインを作成できませんでした");
    }
  }

  /**
   * Checks that a deal's would-be pipeline/stage/contact/company/owner
   * references are all valid, returning the first violation as a
   * user-facing message, or `null` when everything resolves.
   */
  public async validateDealReferences(
    input: Pick<DealCreate, "pipelineId" | "stageId" | "contactId" | "companyId" | "ownerUserId">,
  ): Promise<string | null> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const stage = await orm
      .select({ id: dealStages.id })
      .from(dealStages)
      .innerJoin(
        dealPipelines,
        and(
          eq(dealPipelines.workspaceId, dealStages.workspaceId),
          eq(dealPipelines.id, dealStages.pipelineId),
        ),
      )
      .where(
        and(
          eq(dealStages.workspaceId, workspaceId),
          eq(dealStages.pipelineId, input.pipelineId),
          eq(dealStages.id, input.stageId),
          isNull(dealPipelines.archivedAt),
        ),
      )
      .get();
    if (!stage) return "パイプラインまたはステージが見つかりません";

    if (input.contactId) {
      const contact = await orm
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, workspaceId),
            eq(contacts.id, input.contactId),
            ne(contacts.status, "archived"),
          ),
        )
        .get();
      if (!contact) return "連絡先が見つかりません";
    }

    if (input.companyId) {
      const company = await orm
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.workspaceId, workspaceId), eq(companies.id, input.companyId)))
        .get();
      if (!company) return "会社が見つかりません";
    }

    if (input.ownerUserId && !(await this.memberExists(input.ownerUserId))) {
      return "担当者が見つかりません";
    }
    return null;
  }

  public async pipelineExists(pipelineId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: dealPipelines.id })
      .from(dealPipelines)
      .where(
        and(
          this.inWorkspace(dealPipelines),
          eq(dealPipelines.id, pipelineId),
          isNull(dealPipelines.archivedAt),
        ),
      )
      .get();
    return row !== undefined;
  }

  public async dealExists(dealId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: deals.id })
      .from(deals)
      .where(and(this.inWorkspace(deals), eq(deals.id, dealId), isNull(deals.archivedAt)))
      .get();
    return row !== undefined;
  }

  public async memberExists(userId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, this.context.workspaceId), eq(member.userId, userId)))
      .get();
    return row !== undefined;
  }

  /** Loads every filter option for the deals list/board page in one atomic batch. */
  public async getDealOptionRows(): Promise<DealOptionRows> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [pipelineRows, stageRows, contactRows, companyRows, memberRows] = await orm.batch([
      orm
        .select({
          id: dealPipelines.id,
          name: dealPipelines.name,
          isDefault: dealPipelines.isDefault,
        })
        .from(dealPipelines)
        .where(and(eq(dealPipelines.workspaceId, workspaceId), isNull(dealPipelines.archivedAt)))
        .orderBy(desc(dealPipelines.isDefault), asc(dealPipelines.name)),
      orm
        .select({
          id: dealStages.id,
          pipelineId: dealStages.pipelineId,
          name: dealStages.name,
          color: dealStages.color,
          position: dealStages.position,
          probability: dealStages.probability,
        })
        .from(dealStages)
        .where(eq(dealStages.workspaceId, workspaceId))
        .orderBy(asc(dealStages.pipelineId), asc(dealStages.position)),
      orm
        .select({
          id: contacts.id,
          email: contacts.email,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
        })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), ne(contacts.status, "archived")))
        .orderBy(
          asc(
            sql`coalesce(${contacts.lastName}, ${contacts.firstName}, ${contacts.email}, ${contacts.id})`,
          ),
        )
        .limit(DEAL_OPTION_LIST_LIMIT),
      orm
        .select({ id: companies.id, name: companies.name, domain: companies.domain })
        .from(companies)
        .where(eq(companies.workspaceId, workspaceId))
        .orderBy(asc(companies.name))
        .limit(DEAL_OPTION_LIST_LIMIT),
      orm
        .select({ id: user.id, name: user.name, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, workspaceId))
        .orderBy(asc(user.name), asc(user.email)),
    ]);
    return {
      pipelines: pipelineRows,
      stages: stageRows,
      contacts: contactRows,
      companies: companyRows,
      members: memberRows,
    };
  }

  public async getDeal(id: string): Promise<DealRow | null> {
    const row = await this.dealQuery()
      .where(and(this.inWorkspace(deals), eq(deals.id, id), isNull(deals.archivedAt)))
      .get();
    return row ? dealSummarySchema.parse(row) : null;
  }

  /**
   * A page of deals for one pipeline (list SQL) plus the pipeline-wide status
   * summary (a second, independent SQL: it always covers every non-archived
   * deal of the pipeline, unfiltered by `status`/`q`).
   */
  public async listDeals(input: {
    pipelineId: string;
    status: "open" | "won" | "lost" | "all";
    q?: string | undefined;
  }): Promise<{ items: DealRow[]; summary: DealListSummaryRow | undefined }> {
    const workspaceId = this.context.workspaceId;
    const conditions: SQL[] = [
      eq(deals.workspaceId, workspaceId),
      eq(deals.pipelineId, input.pipelineId),
      isNull(deals.archivedAt),
    ];
    if (input.status !== "all") conditions.push(eq(deals.status, input.status));
    if (input.q) {
      const q = input.q;
      conditions.push(
        or(
          likeContains(deals.name, q),
          likeContains(contacts.email, q),
          likeContains(contacts.firstName, q),
          likeContains(contacts.lastName, q),
          likeContains(companies.name, q),
        )!,
      );
    }

    const [items, summary] = await Promise.all([
      this.dealQuery()
        .where(and(...conditions))
        .orderBy(asc(dealStages.position), desc(deals.updatedAt)),
      this.database.orm
        .select({
          openCount: sql<number>`count(case when ${deals.status} = 'open' then 1 end)`.mapWith(
            Number,
          ),
          openValue:
            sql<number>`coalesce(sum(case when ${deals.status} = 'open' then ${deals.value} else 0 end), 0)`.mapWith(
              Number,
            ),
          wonCount: sql<number>`count(case when ${deals.status} = 'won' then 1 end)`.mapWith(
            Number,
          ),
          wonValue:
            sql<number>`coalesce(sum(case when ${deals.status} = 'won' then ${deals.value} else 0 end), 0)`.mapWith(
              Number,
            ),
          lostCount: sql<number>`count(case when ${deals.status} = 'lost' then 1 end)`.mapWith(
            Number,
          ),
        })
        .from(deals)
        .where(
          and(
            eq(deals.workspaceId, workspaceId),
            eq(deals.pipelineId, input.pipelineId),
            isNull(deals.archivedAt),
          ),
        )
        .get(),
    ]);
    return { items: items.map((row) => dealSummarySchema.parse(row)), summary };
  }

  public async listDealTasks(dealId: string): Promise<DealTaskRow[]> {
    const rows = await this.taskQuery()
      .where(and(this.inWorkspace(dealTasks), eq(dealTasks.dealId, dealId)))
      .orderBy(
        sql`case when ${dealTasks.status} = 'open' then 0 else 1 end`,
        sql`case when ${dealTasks.dueAt} is null then 1 else 0 end`,
        asc(dealTasks.dueAt),
        desc(dealTasks.createdAt),
      );
    return rows.map((row) => dealTaskSchema.parse(row));
  }

  /** Open and completed tasks across non-archived deals in this workspace. */
  public async listWorkspaceTasks(status: DealTaskStatus | "all"): Promise<DealTaskListItemRow[]> {
    const filters: SQL[] = [this.inWorkspace(dealTasks), isNull(deals.archivedAt)];
    if (status !== "all") filters.push(eq(dealTasks.status, status));
    const rows = await this.database.orm
      .select({ ...this.taskSelection(), dealName: deals.name })
      .from(dealTasks)
      .innerJoin(
        deals,
        and(eq(deals.workspaceId, dealTasks.workspaceId), eq(deals.id, dealTasks.dealId)),
      )
      .leftJoin(user, eq(user.id, dealTasks.assignedUserId))
      .where(and(...filters))
      .orderBy(
        sql`case when ${dealTasks.status} = 'open' then 0 else 1 end`,
        sql`case when ${dealTasks.dueAt} is null then 1 else 0 end`,
        asc(dealTasks.dueAt),
        desc(dealTasks.createdAt),
      );
    return rows.map((row) => dealTaskListItemSchema.parse(row));
  }

  /** Inserts a deal (caller has already validated its references) and returns the joined row. */
  public async createDeal(input: DealCreate): Promise<DealRow> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(deals).values({
      id,
      workspaceId: this.context.workspaceId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      name: input.name,
      value: input.value,
      currency: input.currency,
      status: input.status,
      ownerUserId: input.ownerUserId ?? null,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      expectedCloseDate: input.expectedCloseDate ?? null,
      description: input.description,
      wonAt: input.status === "won" ? now : null,
      lostAt: input.status === "lost" ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    return ensureLoaded(await this.getDeal(id), "Created deal");
  }

  /** Overwrites every mutable deal column (caller resolves patch/merge semantics) and returns the fresh row. */
  public async updateDeal(
    id: string,
    input: DealCreate & { wonAt: string | null; lostAt: string | null; updatedAt: string },
  ): Promise<DealRow | null> {
    await this.database.orm
      .update(deals)
      .set({
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        name: input.name,
        value: input.value,
        currency: input.currency,
        status: input.status,
        ownerUserId: input.ownerUserId ?? null,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        expectedCloseDate: input.expectedCloseDate ?? null,
        description: input.description,
        wonAt: input.wonAt,
        lostAt: input.lostAt,
        updatedAt: input.updatedAt,
      })
      .where(and(this.inWorkspace(deals), eq(deals.id, id), isNull(deals.archivedAt)));
    return this.getDeal(id);
  }

  /** True when `stageId` belongs to `pipelineId` in this workspace (no archived-pipeline check, matching moveDeal's historical behavior). */
  public async stageExistsInPipeline(pipelineId: string, stageId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: dealStages.id })
      .from(dealStages)
      .where(
        and(
          this.inWorkspace(dealStages),
          eq(dealStages.pipelineId, pipelineId),
          eq(dealStages.id, stageId),
        ),
      )
      .get();
    return row !== undefined;
  }

  public async moveDeal(id: string, stageId: string): Promise<DealRow | null> {
    await this.database.orm
      .update(deals)
      .set({ stageId, updatedAt: nowIso() })
      .where(and(this.inWorkspace(deals), eq(deals.id, id), isNull(deals.archivedAt)));
    return this.getDeal(id);
  }

  public async archiveDeal(id: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(deals)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(this.inWorkspace(deals), eq(deals.id, id), isNull(deals.archivedAt)));
    return didChange(result);
  }

  public async getTask(dealId: string, taskId: string): Promise<DealTaskRow | null> {
    const row = await this.taskQuery()
      .where(
        and(this.inWorkspace(dealTasks), eq(dealTasks.dealId, dealId), eq(dealTasks.id, taskId)),
      )
      .get();
    return row ? dealTaskSchema.parse(row) : null;
  }

  /** Inserts a deal task (caller has already validated the deal/assignee) and returns the joined row. */
  public async createDealTask(dealId: string, input: DealTaskCreate): Promise<DealTaskRow> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(dealTasks).values({
      id,
      workspaceId: this.context.workspaceId,
      dealId,
      type: input.type,
      title: input.title,
      notes: input.notes,
      dueAt: input.dueAt ?? null,
      status: "open",
      assignedUserId: input.assignedUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return ensureLoaded(await this.getTask(dealId, id), "Created deal task");
  }

  /** Overwrites every mutable task column (caller resolves patch semantics) and returns the fresh row. */
  public async updateDealTask(
    dealId: string,
    taskId: string,
    input: {
      type: DealTaskType;
      title: string;
      notes: string;
      dueAt: string | null;
      status: DealTaskStatus;
      assignedUserId: string | null;
      completedAt: string | null;
      updatedAt: string;
    },
  ): Promise<DealTaskRow | null> {
    await this.database.orm
      .update(dealTasks)
      .set({
        type: input.type,
        title: input.title,
        notes: input.notes,
        dueAt: input.dueAt,
        status: input.status,
        assignedUserId: input.assignedUserId,
        completedAt: input.completedAt,
        updatedAt: input.updatedAt,
      })
      .where(
        and(this.inWorkspace(dealTasks), eq(dealTasks.dealId, dealId), eq(dealTasks.id, taskId)),
      );
    return this.getTask(dealId, taskId);
  }

  public async deleteDealTask(dealId: string, taskId: string): Promise<boolean> {
    const result = await this.database.orm
      .delete(dealTasks)
      .where(
        and(this.inWorkspace(dealTasks), eq(dealTasks.dealId, dealId), eq(dealTasks.id, taskId)),
      );
    return didChange(result);
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
    return { pipeline, stages: await this.listPipelineStages(id) };
  }

  public async createPipeline(input: DealPipelineCreate): Promise<PipelineCreateResult> {
    if (await this.activePipelineNameTaken(input.name)) return { kind: "conflict" };

    const pipelineId = uuidv7();
    const now = nowIso();
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const statements = [
      ...(input.isDefault ? [this.clearDefaultFlag(now)] : []),
      orm.insert(dealPipelines).values({
        id: pipelineId,
        workspaceId,
        name: input.name,
        isDefault: input.isDefault,
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
    if (input.name && (await this.activePipelineNameTaken(input.name, id))) return "conflict";
    if (input.stages) {
      const incomingIds = new Set(input.stages.flatMap((stage) => (stage.id ? [stage.id] : [])));
      const removed = current.stages.filter((stage) => !incomingIds.has(stage.id));
      if (removed.length > 0 && (await this.stagesHaveDeals(removed.map((stage) => stage.id)))) {
        return "stage_in_use";
      }
    }

    const now = nowIso();
    const orm = this.database.orm;
    const statements = [
      ...(input.isDefault === true ? [this.clearDefaultFlag(now, id)] : []),
      orm
        .update(dealPipelines)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          updatedAt: now,
        })
        .where(
          and(
            this.inWorkspace(dealPipelines),
            eq(dealPipelines.id, id),
            isNull(dealPipelines.archivedAt),
          ),
        ),
      ...(input.stages ? this.replaceStageStatements(id, current.stages, input.stages, now) : []),
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
    const current = await this.getPipelineWithStages(id);
    if (!current) return "not_found";
    if ((await this.countActivePipelines()) <= 1) return "last";
    if ((await this.countPipelineDeals(id)) > 0) return "in_use";

    const now = nowIso();
    const suffix = ` [archived ${id.slice(0, 8)}]`;
    const archivedName = `${current.pipeline.name.slice(0, Math.max(0, 191 - suffix.length))}${suffix}`;
    const fallback = current.pipeline.isDefault
      ? await this.database.orm
          .select({ id: dealPipelines.id })
          .from(dealPipelines)
          .where(
            and(
              this.inWorkspace(dealPipelines),
              isNull(dealPipelines.archivedAt),
              ne(dealPipelines.id, id),
            ),
          )
          .orderBy(asc(dealPipelines.createdAt))
          .limit(1)
          .get()
      : null;
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
          ),
        ),
      ...(fallback
        ? [
            this.database.orm
              .update(dealPipelines)
              .set({ isDefault: true, updatedAt: now })
              .where(and(this.inWorkspace(dealPipelines), eq(dealPipelines.id, fallback.id))),
          ]
        : []),
    ];
    const [first, ...rest] = statements;
    if (!first) return "not_found";
    await this.database.orm.batch([first, ...rest]);
    return "ok";
  }

  private async findDefaultPipeline(): Promise<{ id: string } | null> {
    const row = await this.database.orm
      .select({ id: dealPipelines.id })
      .from(dealPipelines)
      .where(and(this.inWorkspace(dealPipelines), isNull(dealPipelines.archivedAt)))
      .orderBy(desc(dealPipelines.isDefault), asc(dealPipelines.createdAt))
      .limit(1)
      .get();
    return row ?? null;
  }

  private async listPipelineStages(pipelineId: string): Promise<DealStageRow[]> {
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

  private async stagesHaveDeals(stageIds: string[]): Promise<boolean> {
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

  private clearDefaultFlag(now: string, exceptId?: string) {
    return this.database.orm
      .update(dealPipelines)
      .set({ isDefault: false, updatedAt: now })
      .where(
        and(
          this.inWorkspace(dealPipelines),
          isNull(dealPipelines.archivedAt),
          ...(exceptId ? [ne(dealPipelines.id, exceptId)] : []),
        ),
      );
  }

  private replaceStageStatements(
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

  /**
   * The deal+pipeline+stage+owner+contact+company join, with the two
   * per-deal task counters. `openTaskCount`/`nextTaskAt` are correlated
   * scalar subqueries built with the query builder (not raw `${column}`
   * interpolation in a select field) — that form renders the correlation
   * columns unqualified in this drizzle version, silently comparing a table
   * to itself. Verified via `.toSQL()`: the emitted WHERE clauses read
   * `"deal_tasks"."workspaceId" = "deals"."workspaceId"` and
   * `"deal_tasks"."dealId" = "deals"."id"`, fully qualified both sides.
   */
  private dealSelection() {
    const openTaskCount = this.database.orm
      .select({ value: count().as("value") })
      .from(dealTasks)
      .where(
        and(
          eq(dealTasks.workspaceId, deals.workspaceId),
          eq(dealTasks.dealId, deals.id),
          eq(dealTasks.status, "open"),
        ),
      );
    const nextTaskAt = this.database.orm
      .select({ value: min(dealTasks.dueAt).as("value") })
      .from(dealTasks)
      .where(
        and(
          eq(dealTasks.workspaceId, deals.workspaceId),
          eq(dealTasks.dealId, deals.id),
          eq(dealTasks.status, "open"),
        ),
      );
    return {
      id: deals.id,
      workspaceId: deals.workspaceId,
      pipelineId: deals.pipelineId,
      pipelineName: dealPipelines.name,
      stageId: deals.stageId,
      stageName: dealStages.name,
      stageColor: dealStages.color,
      stagePosition: dealStages.position,
      stageProbability: dealStages.probability,
      name: deals.name,
      value: deals.value,
      currency: deals.currency,
      status: deals.status,
      ownerUserId: deals.ownerUserId,
      ownerName: user.name,
      ownerEmail: user.email,
      contactId: deals.contactId,
      contactEmail: contacts.email,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      companyId: deals.companyId,
      companyName: companies.name,
      expectedCloseDate: deals.expectedCloseDate,
      description: deals.description,
      wonAt: deals.wonAt,
      lostAt: deals.lostAt,
      archivedAt: deals.archivedAt,
      createdAt: deals.createdAt,
      updatedAt: deals.updatedAt,
      openTaskCount: sql<number>`${openTaskCount}`.mapWith(Number).as("openTaskCount"),
      nextTaskAt: sql<string | null>`${nextTaskAt}`.as("nextTaskAt"),
    };
  }

  private dealQuery() {
    return this.database.orm
      .select(this.dealSelection())
      .from(deals)
      .innerJoin(
        dealPipelines,
        and(
          eq(dealPipelines.workspaceId, deals.workspaceId),
          eq(dealPipelines.id, deals.pipelineId),
        ),
      )
      .innerJoin(
        dealStages,
        and(eq(dealStages.workspaceId, deals.workspaceId), eq(dealStages.id, deals.stageId)),
      )
      .leftJoin(user, eq(user.id, deals.ownerUserId))
      .leftJoin(
        contacts,
        and(eq(contacts.workspaceId, deals.workspaceId), eq(contacts.id, deals.contactId)),
      )
      .leftJoin(
        companies,
        and(eq(companies.workspaceId, deals.workspaceId), eq(companies.id, deals.companyId)),
      );
  }

  private taskSelection() {
    return {
      id: dealTasks.id,
      dealId: dealTasks.dealId,
      type: dealTasks.type,
      title: dealTasks.title,
      notes: dealTasks.notes,
      dueAt: dealTasks.dueAt,
      status: dealTasks.status,
      assignedUserId: dealTasks.assignedUserId,
      assigneeName: user.name,
      assigneeEmail: user.email,
      completedAt: dealTasks.completedAt,
      createdAt: dealTasks.createdAt,
      updatedAt: dealTasks.updatedAt,
    };
  }

  private taskQuery() {
    return this.database.orm
      .select(this.taskSelection())
      .from(dealTasks)
      .leftJoin(user, eq(user.id, dealTasks.assignedUserId));
  }
}
