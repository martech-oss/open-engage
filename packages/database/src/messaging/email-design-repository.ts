import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

import {
  emailBrandProfileSchema,
  type EmailBrandProfile,
  type EmailBrandProfileWrite,
} from "@openengage/core/messaging";

import { assets } from "../assets/schema";
import { organization } from "../auth/schema";
import { nowIso } from "../shared/database-utils";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { emailBrandProfiles, generatedEmailImages } from "./schema";

export class EmailDesignRepository extends WorkspaceRepository {
  public async getBrandProfile(): Promise<EmailBrandProfile> {
    const [workspace, profile] = await this.database.orm.batch([
      this.database.orm
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, this.context.workspaceId))
        .limit(1),
      this.database.orm
        .select()
        .from(emailBrandProfiles)
        .where(eq(emailBrandProfiles.workspaceId, this.context.workspaceId))
        .limit(1),
    ]);
    const stored = profile[0];
    return emailBrandProfileSchema.parse({
      brandName: stored?.brandName ?? workspace[0]?.name ?? "",
      companyDescription: stored?.companyDescription ?? "",
      tone: stored?.tone ?? "",
      logoAssetId: stored?.logoAssetId ?? null,
      websiteUrl: stored?.websiteUrl ?? null,
      primaryColor: stored?.primaryColor ?? "#171717",
      backgroundColor: stored?.backgroundColor ?? "#f4f5f7",
      textColor: stored?.textColor ?? "#171717",
      postalAddress: stored?.postalAddress ?? "",
      updatedAt: stored?.updatedAt ?? null,
    });
  }

  public async upsertBrandProfile(input: EmailBrandProfileWrite): Promise<EmailBrandProfile> {
    const updatedAt = nowIso();
    await this.database.orm
      .insert(emailBrandProfiles)
      .values({ workspaceId: this.context.workspaceId, ...input, updatedAt })
      .onConflictDoUpdate({
        target: emailBrandProfiles.workspaceId,
        set: { ...input, updatedAt },
      });
    return emailBrandProfileSchema.parse({ ...input, updatedAt });
  }

  public async listAiImageCatalog(limit = 200): Promise<
    Array<{
      id: string;
      name: string;
      altText: string;
      width: number | null;
      height: number | null;
    }>
  > {
    return this.database.orm
      .select({
        id: assets.id,
        name: assets.name,
        altText: assets.altText,
        width: assets.width,
        height: assets.height,
      })
      .from(assets)
      .where(
        and(
          eq(assets.workspaceId, this.context.workspaceId),
          eq(assets.kind, "image"),
          eq(assets.visibility, "public"),
          isNull(assets.archivedAt),
        ),
      )
      .limit(limit);
  }

  public async validatePublicImageAssets(assetIds: string[]): Promise<Set<string>> {
    if (assetIds.length === 0) return new Set();
    const rows = await this.database.orm
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.workspaceId, this.context.workspaceId),
          inArray(assets.id, assetIds),
          eq(assets.kind, "image"),
          eq(assets.visibility, "public"),
          isNull(assets.archivedAt),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }
}

export interface GeneratedEmailImageRecord {
  assetId: string;
  workspaceId: string;
  r2Key: string;
  contentType: string;
  expiresAt: string;
  claimedAt: string | null;
}

export class GeneratedEmailImageRepository extends DatabaseRepository {
  public async track(input: {
    assetId: string;
    workspaceId: string;
    requestId: string;
    expiresAt: string;
  }): Promise<void> {
    await this.database.orm.insert(generatedEmailImages).values({
      ...input,
      claimedAt: null,
      createdAt: nowIso(),
    });
  }

  public async getForPreview(
    workspaceId: string,
    assetId: string,
    now: string,
  ): Promise<GeneratedEmailImageRecord | null> {
    const [row] = await this.database.orm
      .select({
        assetId: generatedEmailImages.assetId,
        workspaceId: generatedEmailImages.workspaceId,
        r2Key: assets.r2Key,
        contentType: assets.contentType,
        expiresAt: generatedEmailImages.expiresAt,
        claimedAt: generatedEmailImages.claimedAt,
      })
      .from(generatedEmailImages)
      .innerJoin(assets, eq(assets.id, generatedEmailImages.assetId))
      .where(
        and(
          eq(generatedEmailImages.workspaceId, workspaceId),
          eq(generatedEmailImages.assetId, assetId),
          isNull(assets.archivedAt),
          or(isNotNull(generatedEmailImages.claimedAt), gt(generatedEmailImages.expiresAt, now)),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  public async claim(workspaceId: string, assetIds: string[], now = nowIso()): Promise<void> {
    if (assetIds.length === 0) return;
    await this.database.orm.batch([
      this.database.orm
        .update(assets)
        .set({ visibility: "public", updatedAt: now })
        .where(
          and(
            eq(assets.workspaceId, workspaceId),
            inArray(assets.id, assetIds),
            isNull(assets.archivedAt),
          ),
        ),
      this.database.orm
        .update(generatedEmailImages)
        .set({ claimedAt: now })
        .where(
          and(
            eq(generatedEmailImages.workspaceId, workspaceId),
            inArray(generatedEmailImages.assetId, assetIds),
            isNull(generatedEmailImages.claimedAt),
          ),
        ),
    ]);
  }

  public async availableUnclaimed(
    workspaceId: string,
    assetIds: string[],
    now: string,
  ): Promise<Set<string>> {
    if (assetIds.length === 0) return new Set();
    const rows = await this.database.orm
      .select({ assetId: generatedEmailImages.assetId })
      .from(generatedEmailImages)
      .innerJoin(assets, eq(assets.id, generatedEmailImages.assetId))
      .where(
        and(
          eq(generatedEmailImages.workspaceId, workspaceId),
          inArray(generatedEmailImages.assetId, assetIds),
          isNull(generatedEmailImages.claimedAt),
          gt(generatedEmailImages.expiresAt, now),
          eq(assets.kind, "image"),
          isNull(assets.archivedAt),
        ),
      );
    return new Set(rows.map((row) => row.assetId));
  }

  public async findExpired(now: string, limit = 100): Promise<GeneratedEmailImageRecord[]> {
    return this.database.orm
      .select({
        assetId: generatedEmailImages.assetId,
        workspaceId: generatedEmailImages.workspaceId,
        r2Key: assets.r2Key,
        contentType: assets.contentType,
        expiresAt: generatedEmailImages.expiresAt,
        claimedAt: generatedEmailImages.claimedAt,
      })
      .from(generatedEmailImages)
      .innerJoin(assets, eq(assets.id, generatedEmailImages.assetId))
      .where(and(isNull(generatedEmailImages.claimedAt), lte(generatedEmailImages.expiresAt, now)))
      .limit(limit);
  }

  public async deleteExpiredRows(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return;
    await this.database.orm.delete(assets).where(inArray(assets.id, assetIds));
  }
}
