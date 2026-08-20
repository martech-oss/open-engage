import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import {
  dealTaskListItemSchema,
  dealTaskSchema,
  type DealTaskCreate,
  type DealTaskStatus,
  type DealTaskType,
} from "@openengage/core/deals";

import { user } from "../auth/schema";
import { didChange, ensureLoaded, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { deals, dealTasks } from "./schema";
import type { DealTaskListItemRow, DealTaskRow } from "./types";

export class DealTaskRepository extends WorkspaceRepository {
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
