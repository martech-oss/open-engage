import { and, desc, eq, ne } from "drizzle-orm";

import { siteMessageSchema, type SiteMessage, type SiteMessageWrite } from "@openengage/core/web";

import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { siteMessages } from "./schema";

export class SiteMessageRepository extends WorkspaceRepository {
  public async listSiteMessages(): Promise<SiteMessage[]> {
    const rows = await this.database.orm
      .select({
        id: siteMessages.id,
        name: siteMessages.name,
        status: siteMessages.status,
        audience: siteMessages.audience,
        frequency: siteMessages.frequency,
        headline: siteMessages.headline,
        body: siteMessages.body,
        ctaLabel: siteMessages.ctaLabel,
        ctaUrl: siteMessages.ctaUrl,
        pagePattern: siteMessages.pagePattern,
        startsAt: siteMessages.startsAt,
        endsAt: siteMessages.endsAt,
        impressionCount: siteMessages.impressionCount,
        clickCount: siteMessages.clickCount,
        createdAt: siteMessages.createdAt,
        updatedAt: siteMessages.updatedAt,
      })
      .from(siteMessages)
      .where(and(this.inWorkspace(siteMessages), ne(siteMessages.status, "archived")))
      .orderBy(desc(siteMessages.updatedAt));
    return rows.map((row) => siteMessageSchema.parse(row));
  }

  public async createSiteMessage(input: SiteMessageWrite): Promise<{ id: string }> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(siteMessages).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      status: input.status,
      audience: input.audience ?? "identified",
      frequency: input.frequency ?? "session",
      headline: input.headline,
      body: input.body,
      ctaLabel: input.ctaLabel,
      ctaUrl: input.ctaUrl,
      pagePattern: input.pagePattern,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async updateSiteMessage(id: string, input: SiteMessageWrite): Promise<boolean> {
    const result = await this.database.orm
      .update(siteMessages)
      .set({
        name: input.name,
        status: input.status,
        audience: input.audience ?? "identified",
        frequency: input.frequency ?? "session",
        headline: input.headline,
        body: input.body,
        ctaLabel: input.ctaLabel,
        ctaUrl: input.ctaUrl,
        pagePattern: input.pagePattern,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        updatedAt: nowIso(),
      })
      .where(
        and(
          this.inWorkspace(siteMessages),
          eq(siteMessages.id, id),
          ne(siteMessages.status, "archived"),
        ),
      );
    return changedExactlyOne(result);
  }

  public async archiveSiteMessage(id: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(siteMessages)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(
        and(
          this.inWorkspace(siteMessages),
          eq(siteMessages.id, id),
          ne(siteMessages.status, "archived"),
        ),
      );
    return changedExactlyOne(result);
  }
}
