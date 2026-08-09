import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { jsonRecordSchema, stringArraySchema } from "@openengage/core/shared";
import {
  contentDocumentSchema,
  landingPageSchema,
  signupFormDefinitionSchema,
  signupFormSchema,
  siteMessageSchema,
  siteTrackingSchema,
  type LandingPage,
  type LandingPageWrite,
  type SignupForm,
  type SignupFormWrite,
  type SiteMessage,
  type SiteMessageWrite,
  type SiteTracking,
  type SiteTrackingWrite,
} from "@openengage/core/web";

import { organization } from "../auth/schema";
import { contactEvents, contacts } from "../contacts/schema";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { decodeJson, defineJsonCodec } from "../shared/json-codec";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import {
  forms,
  formSubmissions,
  landingPages,
  landingPageVersions,
  siteMessages,
  siteTrackingSettings,
} from "./schema";

const formDefinitionCodec = defineJsonCodec(signupFormDefinitionSchema, "forms.definition");
const formAllowedDomainsCodec = defineJsonCodec(stringArraySchema, "forms.allowed_domains");
const landingPageContentCodec = defineJsonCodec(
  contentDocumentSchema,
  "landing_page_versions.content_document",
);
const trackingAllowedDomainsCodec = defineJsonCodec(
  stringArraySchema,
  "site_tracking_settings.allowed_domains",
);

export type LandingPageUpdateOutcome =
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "ok"; id: string; versionId: string };

/**
 * Workspace-scoped store for the website center: signup forms, landing
 * pages (+ versions), site tracking settings/analytics and in-app site
 * messages. Also carries the handful of visitor-identity lookups the public
 * tracking and site-message endpoints need once they've already resolved a
 * workspace id (via {@link loadPublicTrackingWorkspace}), for cohesion with
 * the rest of the web domain.
 */
export class WebRepository extends WorkspaceRepository {
  public async listSignupForms(): Promise<SignupForm[]> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const rows = await orm
      .select({
        id: forms.id,
        name: forms.name,
        slug: forms.slug,
        status: forms.status,
        version: forms.version,
        definition: forms.definition,
        allowedDomains: forms.allowedDomains,
        turnstileEnabled: forms.turnstileEnabled,
        successMessage: forms.successMessage,
        // Correlated subquery embedded as a real builder (not a `${col}`
        // interpolation): see the module doc for why that matters.
        submissionCount: sql<number>`${orm.$count(
          formSubmissions,
          and(
            eq(formSubmissions.workspaceId, forms.workspaceId),
            eq(formSubmissions.formId, forms.id),
          ),
        )}`.mapWith(Number),
        createdAt: forms.createdAt,
        updatedAt: forms.updatedAt,
      })
      .from(forms)
      .where(and(eq(forms.workspaceId, workspaceId), ne(forms.status, "archived")))
      .orderBy(desc(forms.updatedAt))
      .limit(UNPAGINATED_LIST_LIMIT);
    return rows.map((row) =>
      signupFormSchema.parse({
        ...row,
        definition: formDefinitionCodec.decode(row.definition),
        allowedDomains: formAllowedDomainsCodec.decode(row.allowedDomains),
      }),
    );
  }

  public async createSignupForm(input: SignupFormWrite): Promise<{ id: string }> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(forms).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      status: input.status,
      definition: formDefinitionCodec.encode(input.definition),
      allowedDomains: formAllowedDomainsCodec.encode(input.allowedDomains),
      turnstileEnabled: input.turnstileEnabled,
      successMessage: input.successMessage,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async updateSignupForm(id: string, input: SignupFormWrite): Promise<boolean> {
    const result = await this.database.orm
      .update(forms)
      .set({
        name: input.name,
        slug: input.slug,
        status: input.status,
        version: sql`${forms.version} + 1`,
        definition: formDefinitionCodec.encode(input.definition),
        allowedDomains: formAllowedDomainsCodec.encode(input.allowedDomains),
        turnstileEnabled: input.turnstileEnabled,
        successMessage: input.successMessage,
        updatedAt: nowIso(),
      })
      .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived")));
    return changedExactlyOne(result);
  }

  public async archiveSignupForm(id: string): Promise<boolean> {
    const result = await this.database.orm
      .update(forms)
      .set({ status: "archived", updatedAt: nowIso() })
      .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived")));
    return changedExactlyOne(result);
  }

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

  /** Loads the tracking settings, 30-day summary/top-pages and recent events in one atomic batch. */
  public async getTracking(): Promise<SiteTracking> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const recentWindow = sql`${contactEvents.occurredAt} >= datetime('now', '-30 days')`;
    const [settingsRows, summaryRows, topPageRows, recentEventRows, organizationRows] =
      await orm.batch([
        orm
          .select({
            enabled: siteTrackingSettings.enabled,
            allowedDomains: siteTrackingSettings.allowedDomains,
            updatedAt: siteTrackingSettings.updatedAt,
          })
          .from(siteTrackingSettings)
          .where(eq(siteTrackingSettings.workspaceId, workspaceId)),
        orm
          .select({
            pageViews: count(),
            uniqueVisitors: countDistinct(contactEvents.visitorId),
            identifiedContacts: countDistinct(contactEvents.contactId),
          })
          .from(contactEvents)
          .where(
            and(
              eq(contactEvents.workspaceId, workspaceId),
              eq(contactEvents.type, "page_viewed"),
              recentWindow,
            ),
          ),
        orm
          .select({ url: contactEvents.resourceId, views: count() })
          .from(contactEvents)
          .where(
            and(
              eq(contactEvents.workspaceId, workspaceId),
              eq(contactEvents.type, "page_viewed"),
              recentWindow,
              isNotNull(contactEvents.resourceId),
            ),
          )
          .groupBy(contactEvents.resourceId)
          .orderBy(desc(count()))
          .limit(10),
        orm
          .select({
            visitorId: contactEvents.visitorId,
            contactId: contactEvents.contactId,
            resourceId: contactEvents.resourceId,
            properties: contactEvents.properties,
            occurredAt: contactEvents.occurredAt,
          })
          .from(contactEvents)
          .where(
            and(eq(contactEvents.workspaceId, workspaceId), eq(contactEvents.type, "page_viewed")),
          )
          .orderBy(desc(contactEvents.occurredAt))
          .limit(20),
        orm
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, workspaceId)),
      ]);
    const settingsRow = settingsRows[0];
    return siteTrackingSchema.parse({
      enabled: settingsRow?.enabled ?? false,
      allowedDomains: settingsRow
        ? trackingAllowedDomainsCodec.decode(settingsRow.allowedDomains)
        : [],
      consentMode: "required",
      workspaceSlug: organizationRows[0]?.slug ?? "",
      summary: {
        pageViews: summaryRows[0]?.pageViews ?? 0,
        uniqueVisitors: summaryRows[0]?.uniqueVisitors ?? 0,
        identifiedContacts: summaryRows[0]?.identifiedContacts ?? 0,
      },
      topPages: topPageRows.map((row) => ({ url: row.url ?? "", views: row.views })),
      recentEvents: recentEventRows.map((row) => ({
        visitorId: row.visitorId ?? "",
        contactId: row.contactId,
        resourceId: row.resourceId ?? "",
        properties: decodeJson(row.properties, jsonRecordSchema, "contact_events.properties"),
        occurredAt: row.occurredAt,
      })),
      updatedAt: settingsRow?.updatedAt ?? null,
    });
  }

  /** Upserts the singleton tracking-settings row for this workspace. */
  public async saveTrackingSettings(input: SiteTrackingWrite): Promise<void> {
    const now = nowIso();
    const allowedDomains = trackingAllowedDomainsCodec.encode([...new Set(input.allowedDomains)]);
    await this.database.orm
      .insert(siteTrackingSettings)
      .values({
        workspaceId: this.context.workspaceId,
        enabled: input.enabled,
        allowedDomains,
        consentMode: "required",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: siteTrackingSettings.workspaceId,
        set: { enabled: input.enabled, allowedDomains, updatedAt: now },
      });
  }

  public async listSiteMessages(): Promise<SiteMessage[]> {
    const rows = await this.database.orm
      .select({
        id: siteMessages.id,
        name: siteMessages.name,
        status: siteMessages.status,
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

  /** Used by the tracking beacon to attach a page view to a known contact. */
  public async findActiveContactIdByEmail(email: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(this.inWorkspace(contacts), eq(contacts.email, email), ne(contacts.status, "archived")),
      )
      .get();
    return row?.id ?? null;
  }

  /** The most recently identified contact behind a tracking visitor id, if any. */
  public async findVisitorContactId(visitorId: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ contactId: contactEvents.contactId })
      .from(contactEvents)
      .where(
        and(
          this.inWorkspace(contactEvents),
          eq(contactEvents.visitorId, visitorId),
          isNotNull(contactEvents.contactId),
        ),
      )
      .orderBy(desc(contactEvents.occurredAt))
      .limit(1)
      .get();
    return row?.contactId ?? null;
  }

  public async listActiveSiteMessagesForVisitor(now: string): Promise<
    Array<{
      id: string;
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
  public async recordSiteMessageEvent(input: {
    contactId: string;
    visitorId: string;
    messageId: string;
    type: "impression" | "click";
  }): Promise<void> {
    const now = nowIso();
    await this.database.orm.insert(contactEvents).values({
      id: uuidv7(),
      workspaceId: this.context.workspaceId,
      contactId: input.contactId,
      visitorId: input.visitorId,
      type: input.type === "impression" ? "site_message_viewed" : "site_message_clicked",
      resourceType: "site_message",
      resourceId: input.messageId,
      properties: "{}",
      occurredAt: now,
      createdAt: now,
    });
  }
}
