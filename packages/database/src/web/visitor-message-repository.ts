import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import { changedExactlyOne } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { siteMessages } from "./schema";
import { persistSiteMessageEvent, type SiteMessageEventInput } from "./site-message-event-writer";

export class VisitorMessageRepository extends WorkspaceRepository {
  public async listActiveSiteMessagesForVisitor(
    now: string,
    identified = false,
  ): Promise<
    Array<{
      id: string;
      audience: "identified" | "all";
      frequency: "session" | "page";
      headline: string;
      body: string;
      ctaLabel: string;
      ctaUrl: string | null;
      pagePattern: string;
    }>
  > {
    return await this.database.orm
      .select({
        id: siteMessages.id,
        audience: siteMessages.audience,
        frequency: siteMessages.frequency,
        headline: siteMessages.headline,
        body: siteMessages.body,
        ctaLabel: siteMessages.ctaLabel,
        ctaUrl: siteMessages.ctaUrl,
        pagePattern: siteMessages.pagePattern,
      })
      .from(siteMessages)
      .where(
        and(
          this.inWorkspace(siteMessages),
          eq(siteMessages.status, "published"),
          identified ? undefined : eq(siteMessages.audience, "all"),
          or(isNull(siteMessages.startsAt), lte(siteMessages.startsAt, now)),
          or(isNull(siteMessages.endsAt), gte(siteMessages.endsAt, now)),
        ),
      )
      .orderBy(desc(siteMessages.updatedAt))
      .limit(20);
  }

  /** Deliberately leaves `updated_at` untouched, matching the prior `updated_at = updated_at` no-op. */
  public async incrementSiteMessageCounter(
    messageId: string,
    counter: "impression" | "click",
  ): Promise<boolean> {
    const scope = and(
      this.inWorkspace(siteMessages),
      eq(siteMessages.id, messageId),
      eq(siteMessages.status, "published"),
    );
    const result =
      counter === "impression"
        ? await this.database.orm
            .update(siteMessages)
            .set({ impressionCount: sql`${siteMessages.impressionCount} + 1` })
            .where(scope)
        : await this.database.orm
            .update(siteMessages)
            .set({ clickCount: sql`${siteMessages.clickCount} + 1` })
            .where(scope);
    return changedExactlyOne(result);
  }

  /** Direct timeline write, deliberately bypassing automation enrollment (unlike `recordContactEvent`). */
  public async recordSiteMessageEvent(input: SiteMessageEventInput): Promise<string> {
    return await persistSiteMessageEvent(this.database, this.context.workspaceId, input);
  }
}
