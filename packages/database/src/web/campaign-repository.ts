import { and, eq, sql } from "drizzle-orm";

import type { ProjectResourceType } from "@openengage/core/projects";

import { deals } from "../deals/schema";
import { deliveries } from "../messaging/schema";
import type { ReportDateRange } from "../reports/repository";
import { nowIso } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { campaignTouches, projectItems, projects } from "./schema";

export interface TouchCandidate {
  resourceType: ProjectResourceType;
  resourceId: string;
}

/**
 * Turns contact events into campaign touches. A touch exists only when the
 * resource the contact interacted with is listed on a project, so linking an
 * asset to a project is the single switch that starts attribution for it.
 */
export class CampaignTouchRepository extends DatabaseRepository {
  /**
   * Email events name a delivery, not the template the project lists, so the
   * template id is resolved here rather than at every call site.
   */
  public async resolveTemplateId(workspaceId: string, deliveryId: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ templateId: deliveries.templateId })
      .from(deliveries)
      .where(and(eq(deliveries.workspaceId, workspaceId), eq(deliveries.id, deliveryId)))
      .get();
    return row?.templateId ?? null;
  }

  public async recordTouches(input: {
    sourceEventId: string;
    workspaceId: string;
    contactId: string;
    candidate: TouchCandidate;
    eventType: string;
    occurredAt: string;
  }): Promise<number> {
    const owners = await this.database.orm
      .select({ projectId: projectItems.projectId })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.workspaceId, input.workspaceId),
          eq(projectItems.resourceType, input.candidate.resourceType),
          eq(projectItems.resourceId, input.candidate.resourceId),
        ),
      );
    if (owners.length === 0) return 0;
    const now = nowIso();
    const result = await this.database.orm
      .insert(campaignTouches)
      .values(
        owners.map((owner) => ({
          id: uuidv7(),
          workspaceId: input.workspaceId,
          projectId: owner.projectId,
          contactId: input.contactId,
          resourceType: input.candidate.resourceType,
          resourceId: input.candidate.resourceId,
          eventType: input.eventType,
          sourceEventId: input.sourceEventId,
          occurredAt: input.occurredAt,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
    return result.meta.changes;
  }
}

export interface CampaignAttributionRow {
  projectId: string;
  projectName: string;
  color: string;
  touches: number;
  contacts: number;
  influencedDeals: number;
  influencedValue: number;
  firstTouchValue: number;
  lastTouchValue: number;
}

/**
 * Attribution reads. Influence counts every project that touched the contact
 * before the deal closed; first- and last-touch split the same revenue by
 * whichever project opened or closed the conversation, so the three columns
 * are deliberately not additive across models.
 */
export class CampaignReportRepository extends DatabaseRepository {
  public async attribution(
    workspaceId: string,
    range: ReportDateRange,
  ): Promise<CampaignAttributionRow[]> {
    const rows = await this.database.orm.all<{
      project_id: string;
      project_name: string;
      color: string;
      touches: number;
      contacts: number;
      influenced_deals: number;
      influenced_value: number;
      first_touch_value: number;
      last_touch_value: number;
    }>(sql`
      WITH won AS (
        SELECT ${deals.id} AS deal_id, ${deals.contactId} AS contact_id,
               ${deals.value} AS value, ${deals.wonAt} AS won_at
        FROM ${deals}
        WHERE ${deals.workspaceId} = ${workspaceId}
          AND ${deals.status} = 'won'
          AND ${deals.contactId} IS NOT NULL
          AND ${deals.wonAt} >= ${range.fromTimestamp}
          AND ${deals.wonAt} < ${range.toExclusiveTimestamp}
      ),
      deal_touch AS (
        SELECT w.deal_id, w.value, t.project_id, t.occurred_at,
               ROW_NUMBER() OVER (PARTITION BY w.deal_id ORDER BY t.occurred_at ASC) AS first_rank,
               ROW_NUMBER() OVER (PARTITION BY w.deal_id ORDER BY t.occurred_at DESC) AS last_rank
        FROM won w
        JOIN ${campaignTouches} t
          ON t.workspace_id = ${workspaceId}
         AND t.contact_id = w.contact_id
         AND t.occurred_at <= w.won_at
      ),
      influence AS (
        -- One row per (project, deal) first, so a project that touched the same
        -- deal five times counts its value once.
        SELECT project_id, COUNT(*) AS deals, SUM(value) AS value
        FROM (SELECT DISTINCT project_id, deal_id, value FROM deal_touch)
        GROUP BY project_id
      ),
      first_touch AS (
        SELECT project_id, SUM(value) AS value FROM deal_touch WHERE first_rank = 1 GROUP BY project_id
      ),
      last_touch AS (
        SELECT project_id, SUM(value) AS value FROM deal_touch WHERE last_rank = 1 GROUP BY project_id
      ),
      touch_stats AS (
        SELECT ${campaignTouches.projectId} AS project_id,
               COUNT(*) AS touches,
               COUNT(DISTINCT ${campaignTouches.contactId}) AS contacts
        FROM ${campaignTouches}
        WHERE ${campaignTouches.workspaceId} = ${workspaceId}
          AND ${campaignTouches.occurredAt} >= ${range.fromTimestamp}
          AND ${campaignTouches.occurredAt} < ${range.toExclusiveTimestamp}
        GROUP BY ${campaignTouches.projectId}
      )
      SELECT ${projects.id} AS project_id,
             ${projects.name} AS project_name,
             ${projects.color} AS color,
             COALESCE(touch_stats.touches, 0) AS touches,
             COALESCE(touch_stats.contacts, 0) AS contacts,
             COALESCE(influence.deals, 0) AS influenced_deals,
             COALESCE(influence.value, 0) AS influenced_value,
             COALESCE(first_touch.value, 0) AS first_touch_value,
             COALESCE(last_touch.value, 0) AS last_touch_value
      FROM ${projects}
      LEFT JOIN touch_stats ON touch_stats.project_id = ${projects.id}
      LEFT JOIN influence ON influence.project_id = ${projects.id}
      LEFT JOIN first_touch ON first_touch.project_id = ${projects.id}
      LEFT JOIN last_touch ON last_touch.project_id = ${projects.id}
      WHERE ${projects.workspaceId} = ${workspaceId} AND ${projects.archivedAt} IS NULL
      ORDER BY influenced_value DESC, touches DESC
      LIMIT 200
    `);
    return rows.map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      color: row.color,
      touches: Number(row.touches) || 0,
      contacts: Number(row.contacts) || 0,
      influencedDeals: Number(row.influenced_deals) || 0,
      influencedValue: Number(row.influenced_value) || 0,
      firstTouchValue: Number(row.first_touch_value) || 0,
      lastTouchValue: Number(row.last_touch_value) || 0,
    }));
  }
}
