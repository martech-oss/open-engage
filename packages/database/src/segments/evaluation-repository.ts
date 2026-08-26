import { and, eq, exists, notExists, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { type CompiledSegment } from "@openengage/core/segments";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { segmentMemberships, segments } from "./schema";
import { compiledFilterSql, memberCountExpression } from "./support";

export interface SegmentDefinitionGuard {
  kind: "dynamic" | "static";
  filterVersion: number;
}

export class SegmentEvaluationRepository extends WorkspaceRepository {
  public async setEvaluationState(
    segmentId: string,
    status: "pending" | "running" | "ready" | "failed",
    error: string | null = null,
    expected?: SegmentDefinitionGuard,
  ): Promise<void> {
    await this.database.orm
      .update(segments)
      .set({ evaluationStatus: status, evaluationError: error, updatedAt: nowIso() })
      .where(
        and(
          this.inWorkspace(segments),
          eq(segments.id, segmentId),
          ...(expected
            ? [
                eq(segments.kind, expected.kind),
                eq(segments.filterVersion, expected.filterVersion),
                ...(status === "failed" ? [eq(segments.evaluationStatus, "running")] : []),
              ]
            : []),
        ),
      );
  }

  /** Recomputes the denormalized `member_count` of one segment. */
  public async updateMemberCount(
    segmentId: string,
    expected?: SegmentDefinitionGuard,
  ): Promise<void> {
    await this.database.orm
      .update(segments)
      .set({ memberCount: memberCountExpression(), updatedAt: nowIso() })
      .where(
        and(
          this.inWorkspace(segments),
          eq(segments.id, segmentId),
          ...(expected
            ? [eq(segments.kind, expected.kind), eq(segments.filterVersion, expected.filterVersion)]
            : []),
        ),
      );
  }

  /**
   * Atomically (one D1 batch) replaces the dynamic memberships of a segment
   * with the contacts matched by the compiled filter, then refreshes the
   * denormalized member count and evaluation timestamp.
   */
  public async replaceDynamicMemberships(
    segmentId: string,
    compiled: CompiledSegment,
    filterVersion: number,
  ): Promise<void> {
    const now = nowIso();
    const orm = this.database.orm;
    const currentDefinition = this.currentDynamicDefinition(segmentId, filterVersion);
    await orm.batch([
      orm
        .delete(segmentMemberships)
        .where(
          and(
            this.inWorkspace(segmentMemberships),
            eq(segmentMemberships.segmentId, segmentId),
            eq(segmentMemberships.source, "dynamic"),
            exists(currentDefinition),
          ),
        ),
      // insert-from-select: drizzle emits the full column list in declaration
      // order, so the SELECT below lists workspace_id, segment_id, contact_id,
      // source, joined_at in exactly that order.
      orm
        .insert(segmentMemberships)
        .select(
          sql`SELECT ${this.context.workspaceId}, ${segmentId}, matched.id, 'dynamic', ${now}
              FROM (${compiledFilterSql(compiled)}) matched
              WHERE matched.status != 'archived'
                AND ${exists(currentDefinition)}`,
        )
        .onConflictDoNothing(),
      orm
        .update(segments)
        .set({
          memberCount: memberCountExpression(),
          evaluatedAt: now,
          evaluationStatus: "ready",
          evaluationError: null,
          updatedAt: now,
        })
        .where(
          and(
            this.inWorkspace(segments),
            eq(segments.id, segmentId),
            eq(segments.kind, "dynamic"),
            eq(segments.filterVersion, filterVersion),
          ),
        ),
    ]);
  }

  /** Runs the compiled filter and returns the matched contact rows, newest id first. */
  public async previewContacts(
    compiled: CompiledSegment,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    return await this.database.orm.all<Record<string, unknown>>(
      sql`SELECT * FROM (${compiledFilterSql(compiled)}) matched
          WHERE matched.status != 'archived' ORDER BY matched.id DESC LIMIT ${limit}`,
    );
  }

  public async previewCount(compiled: CompiledSegment): Promise<number> {
    const rows = await this.database.orm.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM (${compiledFilterSql(compiled)}) matched
          WHERE matched.status != 'archived'`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Executes up to one D1 batch of contact-match statements. */
  public async contactMatchesBatch(
    compiledSegments: readonly CompiledSegment[],
    contactId: string,
  ): Promise<boolean[]> {
    if (compiledSegments.length === 0) return [];
    const statements: BatchItem<"sqlite">[] = compiledSegments.map((compiled) =>
      this.database.orm
        .select({ matched: sql<number>`1` })
        .from(sql`(${compiledFilterSql(compiled)}) matched`)
        .where(sql`matched.id = ${contactId} AND matched.status != 'archived'`)
        .limit(1),
    );
    const results = await this.database.orm.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return results.map((rows) => rows.length > 0);
  }

  /**
   * Applies membership deltas in one transactional D1 batch. Each membership
   * mutation is immediately followed by a guarded `changes()` delta, so a
   * replay neither changes `member_count` nor touches evaluation timestamps.
   */
  public async setDynamicMemberships(
    updates: readonly {
      segmentId: string;
      filterVersion: number;
      contactId: string;
      matched: boolean;
    }[],
  ): Promise<void> {
    if (updates.length === 0) return;
    const statements: BatchItem<"sqlite">[] = updates.flatMap((update) =>
      this.dynamicMembershipStatements(update),
    );
    await this.database.orm.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  private currentDynamicDefinition(segmentId: string, filterVersion: number) {
    const conditions: SQL[] = [
      this.inWorkspace(segments),
      eq(segments.id, segmentId),
      eq(segments.kind, "dynamic"),
    ];
    conditions.push(eq(segments.filterVersion, filterVersion));
    return this.database.orm
      .select({ matched: sql<number>`1` })
      .from(segments)
      .where(and(...conditions));
  }

  private dynamicMembershipStatements(update: {
    segmentId: string;
    filterVersion: number;
    contactId: string;
    matched: boolean;
  }): BatchItem<"sqlite">[] {
    const orm = this.database.orm;
    const now = nowIso();
    const currentDefinition = this.currentDynamicDefinition(update.segmentId, update.filterVersion);
    const anyMembership = orm
      .select({ matched: sql<number>`1` })
      .from(segmentMemberships)
      .where(
        and(
          this.inWorkspace(segmentMemberships),
          eq(segmentMemberships.segmentId, update.segmentId),
          eq(segmentMemberships.contactId, update.contactId),
        ),
      );
    const definitionConditions = and(
      this.inWorkspace(segments),
      eq(segments.id, update.segmentId),
      eq(segments.kind, "dynamic"),
      eq(segments.filterVersion, update.filterVersion),
    );
    if (update.matched) {
      return [
        orm
          .insert(segmentMemberships)
          .select(
            sql`SELECT ${this.context.workspaceId}, ${update.segmentId}, ${update.contactId}, 'dynamic', ${now}
              WHERE ${exists(currentDefinition)} AND ${notExists(anyMembership)}`,
          )
          .onConflictDoNothing(),
        orm
          .update(segments)
          .set({
            memberCount: sql`${segments.memberCount} + changes()`,
            evaluatedAt: now,
            evaluationStatus: "ready",
            evaluationError: null,
            updatedAt: now,
          })
          .where(and(definitionConditions, sql`changes() > 0`)),
      ];
    }
    return [
      orm
        .delete(segmentMemberships)
        .where(
          and(
            this.inWorkspace(segmentMemberships),
            eq(segmentMemberships.segmentId, update.segmentId),
            eq(segmentMemberships.contactId, update.contactId),
            eq(segmentMemberships.source, "dynamic"),
            exists(currentDefinition),
          ),
        ),
      orm
        .update(segments)
        .set({
          memberCount: sql`MAX(${segments.memberCount} - changes(), 0)`,
          evaluatedAt: now,
          evaluationStatus: "ready",
          evaluationError: null,
          updatedAt: now,
        })
        .where(and(definitionConditions, sql`changes() > 0`)),
    ];
  }
}
