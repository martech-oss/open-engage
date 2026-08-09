import { and, count, desc, eq, inArray, isNotNull, isNull, lt, type SQL } from "drizzle-orm";

import { organization } from "../auth/schema";
import { changedExactlyOne, likeContains, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { assets } from "./schema";

export interface AssetRow {
  id: string;
  name: string;
  originalFilename: string;
  kind: string;
  description: string;
  altText: string;
  r2Key: string;
  contentType: string;
  size: number;
  checksum: string;
  checksumAlgorithm: string;
  width: number | null;
  height: number | null;
  visibility: string;
  createdByUserId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const assetColumns = {
  id: assets.id,
  name: assets.name,
  originalFilename: assets.originalFilename,
  kind: assets.kind,
  description: assets.description,
  altText: assets.altText,
  r2Key: assets.r2Key,
  contentType: assets.contentType,
  size: assets.size,
  checksum: assets.checksum,
  checksumAlgorithm: assets.checksumAlgorithm,
  width: assets.width,
  height: assets.height,
  visibility: assets.visibility,
  createdByUserId: assets.createdByUserId,
  archivedAt: assets.archivedAt,
  createdAt: assets.createdAt,
  updatedAt: assets.updatedAt,
} as const;

export interface AssetListFilter {
  status?: "active" | "archived" | "all";
  kind?: string | undefined;
  visibility?: string | undefined;
  query?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface AssetListPage {
  items: AssetRow[];
  total: number;
  hasMore: boolean;
}

export interface AssetContentPatch {
  originalFilename: string;
  kind: string;
  r2Key: string;
  contentType: string;
  size: number;
  checksum: string;
  checksumAlgorithm: string;
  width: number | null;
  height: number | null;
}

export interface AssetMetadataPatch {
  name: string;
  description: string;
  altText: string;
  visibility: string;
}

/** DB-only reads/writes for the asset library. R2 object storage, checksums, and audit logging stay in `apps/server`. */
export class AssetRepository extends WorkspaceRepository {
  public async list(filter: AssetListFilter): Promise<AssetListPage> {
    const conditions: SQL[] = [this.inWorkspace(assets)];
    if (filter.status === "active") conditions.push(isNull(assets.archivedAt));
    if (filter.status === "archived") conditions.push(isNotNull(assets.archivedAt));
    if (filter.kind) conditions.push(eq(assets.kind, filter.kind));
    if (filter.visibility) conditions.push(eq(assets.visibility, filter.visibility));
    if (filter.query) conditions.push(likeContains(assets.name, filter.query));

    const [totalRow] = await this.database.orm
      .select({ count: count() })
      .from(assets)
      .where(and(...conditions));

    const pageConditions: SQL[] = [...conditions];
    if (filter.cursor) pageConditions.push(lt(assets.id, filter.cursor));

    // uuidv7 embeds the creation millisecond in its high bits and is stamped in
    // the same statement as `createdAt`, so ordering by id is ordering by
    // creation time - which lets the cursor stay a single column.
    const rows = await this.database.orm
      .select(assetColumns)
      .from(assets)
      .where(and(...pageConditions))
      .orderBy(desc(assets.id))
      .limit(filter.limit + 1);

    const hasMore = rows.length > filter.limit;
    return { items: rows.slice(0, filter.limit), total: totalRow?.count ?? 0, hasMore };
  }

  public async getById(assetId: string): Promise<AssetRow | null> {
    const [row] = await this.database.orm
      .select(assetColumns)
      .from(assets)
      .where(and(this.inWorkspace(assets), eq(assets.id, assetId)))
      .limit(1);
    return row ?? null;
  }

  public async getByIds(assetIds: string[]): Promise<AssetRow[]> {
    if (assetIds.length === 0) return [];
    return this.database.orm
      .select(assetColumns)
      .from(assets)
      .where(and(this.inWorkspace(assets), inArray(assets.id, assetIds)));
  }

  public async insert(row: AssetRow): Promise<void> {
    await this.database.orm
      .insert(assets)
      .values({ ...row, workspaceId: this.context.workspaceId });
  }

  public async updateContent(assetId: string, patch: AssetContentPatch): Promise<string> {
    const updatedAt = nowIso();
    await this.database.orm
      .update(assets)
      .set({ ...patch, updatedAt })
      .where(and(this.inWorkspace(assets), eq(assets.id, assetId)));
    return updatedAt;
  }

  public async updateMetadata(assetId: string, patch: AssetMetadataPatch): Promise<string> {
    const updatedAt = nowIso();
    await this.database.orm
      .update(assets)
      .set({ ...patch, updatedAt })
      .where(and(this.inWorkspace(assets), eq(assets.id, assetId)));
    return updatedAt;
  }

  public async archive(assetId: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(assets)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(this.inWorkspace(assets), eq(assets.id, assetId), isNull(assets.archivedAt)));
    return changedExactlyOne(result);
  }

  public async restore(assetId: string): Promise<boolean> {
    const result = await this.database.orm
      .update(assets)
      .set({ archivedAt: null, updatedAt: nowIso() })
      .where(and(this.inWorkspace(assets), eq(assets.id, assetId), isNotNull(assets.archivedAt)));
    return changedExactlyOne(result);
  }

  public async deleteRow(assetId: string): Promise<boolean> {
    const result = await this.database.orm
      .delete(assets)
      .where(and(this.inWorkspace(assets), eq(assets.id, assetId)));
    return changedExactlyOne(result);
  }

  /** The public workspace slug used to build a public asset URL; falls back to the id. */
  public async workspaceSlug(): Promise<string | null> {
    const row = await this.database.orm.query.organization.findFirst({
      columns: { slug: true },
      where: eq(organization.id, this.context.workspaceId),
    });
    return row?.slug ?? null;
  }
}
