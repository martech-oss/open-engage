import { asc, eq } from "drizzle-orm";

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
      .where(eq(segments.kind, "dynamic"))
      .orderBy(asc(segments.workspaceId), asc(segments.id))
      .limit(10_000);
  }
}
