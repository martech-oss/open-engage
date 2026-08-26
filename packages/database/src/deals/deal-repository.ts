import { and, asc, count, desc, eq, isNull, min, ne, or, sql, type SQL } from "drizzle-orm";

import { dealSummarySchema, type DealCreate } from "@openengage/core/deals";

import { user } from "../auth/schema";
import { companies, contacts } from "../contacts/schema";
import { didChange, ensureLoaded, likeContains, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { DealOptionsRepository } from "./options-repository";
import { dealPipelines, deals, dealStages, dealTasks } from "./schema";
import type { DealListSummaryRow, DealRow } from "./types";

export class DealRecordRepository extends WorkspaceRepository {
  private readonly options = new DealOptionsRepository(this.database, this.context);

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

    if (input.ownerUserId && !(await this.options.memberExists(input.ownerUserId))) {
      return "担当者が見つかりません";
    }
    return null;
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

  /** The deal join plus one grouped open-task summary row per deal. */
  private dealSelection(openTaskSummary: ReturnType<DealRecordRepository["openTaskSummary"]>) {
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
      openTaskCount: sql<number>`coalesce(${openTaskSummary.openTaskCount}, 0)`.mapWith(Number),
      nextTaskAt: openTaskSummary.nextTaskAt,
    };
  }

  private openTaskSummary() {
    return this.database.orm
      .select({
        workspaceId: dealTasks.workspaceId,
        dealId: dealTasks.dealId,
        openTaskCount: count().as("open_task_count"),
        nextTaskAt: min(dealTasks.dueAt).as("next_task_at"),
      })
      .from(dealTasks)
      .where(and(eq(dealTasks.workspaceId, this.context.workspaceId), eq(dealTasks.status, "open")))
      .groupBy(dealTasks.workspaceId, dealTasks.dealId)
      .as("open_task_summary");
  }

  private dealQuery() {
    const openTaskSummary = this.openTaskSummary();
    return this.database.orm
      .select(this.dealSelection(openTaskSummary))
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
      )
      .leftJoin(
        openTaskSummary,
        and(
          eq(openTaskSummary.workspaceId, deals.workspaceId),
          eq(openTaskSummary.dealId, deals.id),
        ),
      );
  }
}
