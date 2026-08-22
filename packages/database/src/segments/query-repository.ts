import { and, desc, eq, type SQL } from "drizzle-orm";

import { type SegmentFilter } from "@openengage/core/segments";

import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { segments } from "./schema";
import { filterAstCodec } from "./support";
import type { SegmentRecord } from "./types";

export class SegmentQueryRepository extends WorkspaceRepository {
  public async isSlugAvailable(slug: string): Promise<boolean> {
    const rows = await this.database.orm
      .select({ id: segments.id })
      .from(segments)
      .where(and(this.inWorkspace(segments), eq(segments.slug, slug)))
      .limit(1);
    return rows.length === 0;
  }

  public async listSegments(kind?: "static" | "dynamic"): Promise<SegmentRecord[]> {
    const conditions: SQL[] = [this.inWorkspace(segments)];
    if (kind) conditions.push(eq(segments.kind, kind));
    const rows = await this.database.orm
      .select()
      .from(segments)
      .where(and(...conditions))
      .orderBy(desc(segments.updatedAt))
      .limit(UNPAGINATED_LIST_LIMIT);
    return rows.map((row) => ({
      ...row,
      filterAst: filterAstCodec.decodeNullable(row.filterAst),
    }));
  }

  /**
   * Loads the fields a membership refresh needs. `kind` intentionally stays a
   * plain string: callers treat anything that is not "static" as dynamic.
   */
  public async findSegmentDefinition(id: string): Promise<{
    id: string;
    kind: string;
    filterAst: SegmentFilter | null;
    filterVersion: number;
  } | null> {
    const [row] = await this.database.orm
      .select({
        id: segments.id,
        kind: segments.kind,
        filterAst: segments.filterAst,
        filterVersion: segments.filterVersion,
      })
      .from(segments)
      .where(and(this.inWorkspace(segments), eq(segments.id, id)))
      .limit(1);
    return row ? { ...row, filterAst: filterAstCodec.decodeNullable(row.filterAst) } : null;
  }

  public async getSegment(id: string): Promise<SegmentRecord | null> {
    const [row] = await this.database.orm
      .select()
      .from(segments)
      .where(and(this.inWorkspace(segments), eq(segments.id, id)))
      .limit(1);
    return row ? { ...row, filterAst: filterAstCodec.decodeNullable(row.filterAst) } : null;
  }
}
