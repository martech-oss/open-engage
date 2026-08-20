import { and, eq, sql } from "drizzle-orm";

import { type CompiledSegment } from "@openengage/core/segments";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { SegmentQueryRepository } from "./query-repository";
import { segmentMemberships, segments } from "./schema";
import { compiledFilterSql, memberCountExpression } from "./support";

export class SegmentEvaluationRepository extends WorkspaceRepository {
  private readonly queries = new SegmentQueryRepository(this.database, this.context);

  public async setEvaluationState(
    segmentId: string,
    status: "pending" | "running" | "ready" | "failed",
    error: string | null = null,
  ): Promise<void> {
    await this.database.orm
      .update(segments)
      .set({ evaluationStatus: status, evaluationError: error, updatedAt: nowIso() })
      .where(and(this.inWorkspace(segments), eq(segments.id, segmentId)));
  }

  /** Recomputes the denormalized `member_count` of one segment. */
  public async updateMemberCount(segmentId: string): Promise<void> {
    await this.database.orm
      .update(segments)
      .set({ memberCount: memberCountExpression(), updatedAt: nowIso() })
      .where(and(this.inWorkspace(segments), eq(segments.id, segmentId)));
  }

  /**
   * Atomically (one D1 batch) replaces the dynamic memberships of a segment
   * with the contacts matched by the compiled filter, then refreshes the
   * denormalized member count and evaluation timestamp.
   */
  public async replaceDynamicMemberships(
    segmentId: string,
    compiled: CompiledSegment,
    filterVersion?: number,
  ): Promise<void> {
    if (filterVersion !== undefined) {
      const definition = await this.queries.findSegmentDefinition(segmentId);
      if (!definition || definition.filterVersion !== filterVersion) return;
    }
    const now = nowIso();
    const orm = this.database.orm;
    await orm.batch([
      orm
        .delete(segmentMemberships)
        .where(
          and(
            this.inWorkspace(segmentMemberships),
            eq(segmentMemberships.segmentId, segmentId),
            eq(segmentMemberships.source, "dynamic"),
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
              WHERE matched.status != 'archived'`,
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
        .where(and(this.inWorkspace(segments), eq(segments.id, segmentId))),
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

  public async contactMatches(compiled: CompiledSegment, contactId: string): Promise<boolean> {
    const rows = await this.database.orm.all<{ matched: number }>(
      sql`SELECT 1 AS matched FROM (${compiledFilterSql(compiled)}) matched
          WHERE matched.id = ${contactId} AND matched.status != 'archived' LIMIT 1`,
    );
    return rows.length > 0;
  }

  public async setDynamicMembership(
    segmentId: string,
    contactId: string,
    matched: boolean,
  ): Promise<void> {
    const now = nowIso();
    const orm = this.database.orm;
    const membershipMutation = matched
      ? orm
          .insert(segmentMemberships)
          .values({
            workspaceId: this.context.workspaceId,
            segmentId,
            contactId,
            source: "dynamic",
            joinedAt: now,
          })
          .onConflictDoNothing()
      : orm
          .delete(segmentMemberships)
          .where(
            and(
              this.inWorkspace(segmentMemberships),
              eq(segmentMemberships.segmentId, segmentId),
              eq(segmentMemberships.contactId, contactId),
              eq(segmentMemberships.source, "dynamic"),
            ),
          );
    await orm.batch([
      membershipMutation,
      orm
        .update(segments)
        .set({
          memberCount: memberCountExpression(),
          evaluatedAt: now,
          evaluationStatus: "ready",
          evaluationError: null,
          updatedAt: now,
        })
        .where(and(this.inWorkspace(segments), eq(segments.id, segmentId))),
    ]);
  }
}
