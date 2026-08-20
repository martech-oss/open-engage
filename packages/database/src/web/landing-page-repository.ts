import { and, desc, eq, ne, sql } from "drizzle-orm";

import {
  contentDocumentSchema,
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
  | { kind: "ok"; id: string; versionId: string };

export class LandingPageRepository extends WorkspaceRepository {
  public async listLandingPages(): Promise<LandingPage[]> {
    const rows = await this.database.orm
      .select({
        id: landingPages.id,
        name: landingPages.name,
        slug: landingPages.slug,
        status: landingPages.status,
        currentVersionId: landingPages.currentVersionId,
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
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(landingPageVersions).values({
        id: versionId,
        workspaceId,
        pageId: id,
        version: 1,
        contentDocument: landingPageContentCodec.encode(input.content),
        publishedAt: input.status === "published" ? now : null,
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
      .select({ id: landingPages.id, status: landingPages.status })
      .from(landingPages)
      .where(and(eq(landingPages.workspaceId, workspaceId), eq(landingPages.id, id)))
      .get();
    if (!page) return { kind: "not_found" };
    if (page.status === "archived") return { kind: "archived" };
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
        pageId: page.id,
        version: nextVersion,
        contentDocument: landingPageContentCodec.encode(input.content),
        publishedAt: input.status === "published" ? now : null,
        createdAt: now,
      }),
      orm
        .update(landingPages)
        .set({
          name: input.name,
          slug: input.slug,
          status: input.status,
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
