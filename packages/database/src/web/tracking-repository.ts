import { and, count, countDistinct, desc, eq, isNotNull, sql } from "drizzle-orm";

import { jsonRecordSchema, stringArraySchema } from "@openengage/core/shared";
import {
  siteTrackingSchema,
  type SiteTracking,
  type SiteTrackingWrite,
} from "@openengage/core/web";

import { organization } from "../auth/schema";
import { contactEvents } from "../contacts/schema";
import { nowIso } from "../shared/database-utils";
import { decodeJson, defineJsonCodec } from "../shared/json-codec";
import { WorkspaceRepository } from "../shared/repository-base";
import { siteTrackingSettings } from "./schema";

const trackingAllowedDomainsCodec = defineJsonCodec(
  stringArraySchema,
  "site_tracking_settings.allowed_domains",
);

export class SiteTrackingRepository extends WorkspaceRepository {
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
}
