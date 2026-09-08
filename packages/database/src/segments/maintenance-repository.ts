import { and, asc, eq, sql } from "drizzle-orm";

import type { OpenEngageDatabase } from "../client";
import { segments } from "./schema";

export class SegmentMaintenanceRepository {
  public constructor(private readonly database: OpenEngageDatabase) {}

  public listDynamicSegmentsForCorrection(): Promise<
    Array<{ workspaceId: string; segmentId: string; filterVersion: number }>
  > {
    return this.database.orm
      .select({
        workspaceId: segments.workspaceId,
        segmentId: segments.id,
        filterVersion: segments.filterVersion,
      })
      .from(segments)
      .where(
        and(
          eq(segments.kind, "dynamic"),
          sql`(${segments.evaluatedAt} IS NULL OR julianday(${segments.evaluatedAt}) < julianday('now', '-2 minutes'))`,
        ),
      )
      .orderBy(asc(segments.evaluatedAt), asc(segments.id))
      .limit(10_000);
  }
}
