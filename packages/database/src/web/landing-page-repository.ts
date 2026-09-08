import { and, desc, eq, ne, sql } from "drizzle-orm";

import {
  contentDocumentSchema,
  emptyLandingPageDocument,
  landingPageDocumentSchema,
  landingPageSchema,
  type LandingPage,
  type LandingPageWrite,
} from "@openengage/core/web";

import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { landingPages, landingPageVersions } from "./schema";

const landingPageContentCodec = defineJsonCodec(
  contentDocumentSchema,
  "landing_page_versions.content_document",
);

export type LandingPageUpdateOutcome =
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "conflict" }
  | { kind: "ok"; id: string; versionId: string };

export class LandingPageRepository extends WorkspaceRepository {
  public async isSlugAvailable(slug: string): Promise<boolean> {
    const rows = await this.database.orm
      .select({ id: landingPages.id })
      .from(landingPages)
      .where(and(this.inWorkspace(landingPages), eq(landingPages.slug, slug)))
      .limit(1);
    return rows.length === 0;
  }

  public async listLandingPages(): Promise<LandingPage[]> {
    const rows = await this.database.orm
      .select({
        id: landingPages.id,
        name: landingPages.name,
        slug: landingPages.slug,
        status: landingPages.status,
        currentVersionId: landingPages.currentVersionId,
        publishedVersionId: landingPages.publishedVersionId,
        document: landingPageVersions.document,
        createdAt: landingPages.createdAt,
        updatedAt: landingPages.updatedAt,
        version: landingPageVersions.version,
        contentDocument: landingPageVersions.contentDocument,
      })
      .from(landingPages)
      .leftJoin(
        landingPageVersions,
        and(
          eq(landingPageVersions.workspaceId, landingPages.workspaceId),
          eq(landingPageVersions.id, landingPages.currentVersionId),
        ),
      )
      .where(and(this.inWorkspace(landingPages), ne(landingPages.status, "archived")))
      .orderBy(desc(landingPages.updatedAt));
    return rows.map((row) =>
      landingPageSchema.parse({
        ...row,
        contentDocument: landingPageContentCodec.decodeNullable(row.contentDocument),
        document: row.document ? landingPageDocumentSchema.parse(JSON.parse(row.document)) : null,
      }),
    );
  }

  public async createLandingPage(
    input: LandingPageWrite,
  ): Promise<{ id: string; versionId: string }> {
    const id = uuidv7();
    const versionId = uuidv7();
    const now = nowIso();
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(landingPages).values({
        id,
        workspaceId,
        name: input.name,
        slug: input.slug,
        status: input.status,
        currentVersionId: versionId,
        publishedVersionId: input.status === "published" ? versionId : null,
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(landingPageVersions).values({
        id: versionId,
        workspaceId,
        pageId: id,
        version: 1,
        contentDocument: input.content
          ? landingPageContentCodec.encode(input.content)
          : landingPageContentCodec.encode(
              contentDocumentSchema.parse({ schemaVersion: 1, blocks: [] }),
            ),
        document: input.document
          ? JSON.stringify(input.document)
          : input.content
            ? null
            : JSON.stringify(emptyLandingPageDocument(input.name)),
        publishedAt: input.content && input.status === "published" ? now : null,
        createdAt: now,
      }),
    ]);
    return { id, versionId };
  }

  /** Each edit appends a new version row and repoints the page at it. */
  public async updateLandingPage(
    id: string,
    input: LandingPageWrite,
  ): Promise<LandingPageUpdateOutcome> {
    const workspaceId = this.context.workspaceId;
    const page = await this.database.orm
      .select({
        id: landingPages.id,
        status: landingPages.status,
        currentVersionId: landingPages.currentVersionId,
      })
      .from(landingPages)
      .where(and(eq(landingPages.workspaceId, workspaceId), eq(landingPages.id, id)))
      .get();
    if (!page) return { kind: "not_found" };
    if (page.status === "archived") return { kind: "archived" };
    if (input.baseVersionId && input.baseVersionId !== page.currentVersionId)
      return { kind: "conflict" };
    // A plain (non-correlated) lookup keyed on the id we already resolved
    // above, so there's no outer-query column to interpolate — and none of
    // the SELECT-column-position pitfall this file otherwise avoids.
    const [versionRow] = await this.database.orm
      .select({ maxVersion: sql<number>`coalesce(max(${landingPageVersions.version}), 0)` })
      .from(landingPageVersions)
      .where(
        and(
          eq(landingPageVersions.workspaceId, workspaceId),
          eq(landingPageVersions.pageId, page.id),
        ),
      );
    const nextVersion = (versionRow?.maxVersion ?? 0) + 1;
    const versionId = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(landingPageVersions).values({
        id: versionId,
        workspaceId,
        pageId: sql`CASE WHEN EXISTS (SELECT 1 FROM landing_pages WHERE id = ${page.id} AND workspace_id = ${workspaceId} AND current_version_id = ${page.currentVersionId}) THEN ${page.id} ELSE NULL END`,
        version: nextVersion,
        contentDocument: input.content
          ? landingPageContentCodec.encode(input.content)
          : landingPageContentCodec.encode(
              contentDocumentSchema.parse({ schemaVersion: 1, blocks: [] }),
            ),
        document: input.document
          ? JSON.stringify(input.document)
          : input.content
            ? null
            : JSON.stringify(emptyLandingPageDocument(input.name)),
        publishedAt: input.content && input.status === "published" ? now : null,
        createdAt: now,
      }),
      orm
        .update(landingPages)
        .set({
          name: input.name,
          slug: input.slug,
          status: input.content ? input.status : page.status,
          ...(input.content && input.status === "published"
            ? { publishedVersionId: versionId }
            : {}),
          currentVersionId: versionId,
          updatedAt: now,
        })
        .where(and(eq(landingPages.workspaceId, workspaceId), eq(landingPages.id, page.id))),
    ]);
    return { kind: "ok", id: page.id, versionId };
  }

  public async archiveLandingPage(id: string): Promise<boolean> {
    const result = await this.database.orm
      .update(landingPages)
      .set({ status: "archived", updatedAt: nowIso() })
      .where(
        and(
          this.inWorkspace(landingPages),
          eq(landingPages.id, id),
          ne(landingPages.status, "archived"),
        ),
      );
    return changedExactlyOne(result);
  }
}
