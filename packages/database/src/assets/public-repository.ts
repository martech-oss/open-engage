import { and, eq, isNull } from "drizzle-orm";

import { organization } from "../auth/schema";
import { DatabaseRepository } from "../shared/repository-base";
import { assets } from "./schema";

export interface PublicAssetRecord {
  id: string;
  workspaceId: string;
  name: string;
  originalFilename: string;
  kind: string;
  r2Key: string;
  contentType: string;
  checksum: string;
}

/**
 * The single gate in front of publicly readable assets. The shared bucket also
 * holds private exports and attachments, so workspace slug, public visibility,
 * and active status are all load-bearing predicates.
 */
export class PublicAssetRepository extends DatabaseRepository {
  public async findPublicAsset(
    workspaceSlug: string,
    assetId: string,
  ): Promise<PublicAssetRecord | null> {
    const row = await this.database.orm
      .select({
        id: assets.id,
        workspaceId: assets.workspaceId,
        name: assets.name,
        originalFilename: assets.originalFilename,
        kind: assets.kind,
        r2Key: assets.r2Key,
        contentType: assets.contentType,
        checksum: assets.checksum,
      })
      .from(assets)
      .innerJoin(organization, eq(organization.id, assets.workspaceId))
      .where(
        and(
          eq(organization.slug, workspaceSlug),
          eq(assets.id, assetId),
          eq(assets.visibility, "public"),
          isNull(assets.archivedAt),
        ),
      )
      .get();
    return row ?? null;
  }
}
