import { and, count, desc, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";

import {
  automationDefinitionSchema,
  type AutomationDefinition,
} from "@openengage/core/automations";

import { deliveries, emailTemplates } from "../messaging/schema";
import { defineJsonCodec } from "../shared/json-codec";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import {
  automationEnrollments,
  automations,
  automationTriggers,
  automationVersions,
} from "./schema";

const graphCodec = defineJsonCodec(automationDefinitionSchema, "automation_versions.graph");

export interface AutomationAnalyticsRows {
  enrollments: Array<{ status: string; count: number }>;
  deliveries: Array<{ status: string; count: number }>;
}

export class AutomationQueryRepository extends WorkspaceRepository {
  public async analytics(automationId: string): Promise<AutomationAnalyticsRows> {
    const workspaceId = this.context.workspaceId;
    const [enrollmentRows, deliveryRows] = await Promise.all([
      this.database.orm
        .select({ status: automationEnrollments.status, count: count() })
        .from(automationEnrollments)
        .where(
          and(
            eq(automationEnrollments.workspaceId, workspaceId),
            eq(automationEnrollments.automationId, automationId),
          ),
        )
        .groupBy(automationEnrollments.status),
      this.database.orm
        .select({ status: deliveries.status, count: count() })
        .from(deliveries)
        .innerJoin(
          automationEnrollments,
          and(
            eq(automationEnrollments.id, deliveries.enrollmentId),
            eq(automationEnrollments.workspaceId, deliveries.workspaceId),
          ),
        )
        .where(
          and(
            eq(deliveries.workspaceId, workspaceId),
            eq(automationEnrollments.automationId, automationId),
          ),
        )
        .groupBy(deliveries.status),
    ]);
    return { enrollments: enrollmentRows, deliveries: deliveryRows };
  }

  /** Automation list rows with enrollment counters and the published trigger source. */
  public async listAutomationsWithCounts(): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      status: string;
      triggerSource: string | null;
      enrollmentCount: number;
      activeCount: number;
      completedCount: number;
      updatedAt: string;
    }>
  > {
    const workspaceId = this.context.workspaceId;
    const triggerSummary = this.database.orm
      .select({
        workspaceId: automationTriggers.workspaceId,
        automationVersionId: automationTriggers.automationVersionId,
        source: max(automationTriggers.source).as("source"),
      })
      .from(automationTriggers)
      .where(eq(automationTriggers.workspaceId, workspaceId))
      .groupBy(automationTriggers.workspaceId, automationTriggers.automationVersionId)
      .as("published_trigger_summary");
    const enrollmentSummary = this.database.orm
      .select({
        workspaceId: automationEnrollments.workspaceId,
        automationId: automationEnrollments.automationId,
        enrollmentCount: count().as("enrollment_count"),
        activeCount:
          sql<number>`sum(case when ${automationEnrollments.status} = 'active' then 1 else 0 end)`.as(
            "active_count",
          ),
        completedCount:
          sql<number>`sum(case when ${automationEnrollments.status} = 'completed' then 1 else 0 end)`.as(
            "completed_count",
          ),
      })
      .from(automationEnrollments)
      .where(eq(automationEnrollments.workspaceId, workspaceId))
      .groupBy(automationEnrollments.workspaceId, automationEnrollments.automationId)
      .as("enrollment_summary");
    return await this.database.orm
      .select({
        id: automations.id,
        name: automations.name,
        description: automations.description,
        status: automations.status,
        triggerSource: triggerSummary.source,
        enrollmentCount: sql<number>`coalesce(${enrollmentSummary.enrollmentCount}, 0)`.mapWith(
          Number,
        ),
        activeCount: sql<number>`coalesce(${enrollmentSummary.activeCount}, 0)`.mapWith(Number),
        completedCount: sql<number>`coalesce(${enrollmentSummary.completedCount}, 0)`.mapWith(
          Number,
        ),
        updatedAt: automations.updatedAt,
      })
      .from(automations)
      .leftJoin(
        triggerSummary,
        and(
          eq(triggerSummary.workspaceId, automations.workspaceId),
          eq(triggerSummary.automationVersionId, automations.publishedVersionId),
        ),
      )
      .leftJoin(
        enrollmentSummary,
        and(
          eq(enrollmentSummary.workspaceId, automations.workspaceId),
          eq(enrollmentSummary.automationId, automations.id),
        ),
      )
      .where(this.inWorkspace(automations))
      .orderBy(desc(automations.updatedAt))
      .limit(UNPAGINATED_LIST_LIMIT);
  }

  /** The draft graph of one automation plus the automation status. */
  public async getDraft(
    automationId: string,
  ): Promise<{ graph: AutomationDefinition; status: string } | null> {
    const row = await this.database.orm
      .select({ graph: automationVersions.graph, status: automations.status })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.draftVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(and(this.inWorkspace(automations), eq(automations.id, automationId)))
      .get();
    return row
      ? {
          ...row,
          graph: graphCodec.decode(row.graph),
        }
      : null;
  }

  /** The automation's current draft version, if it is still publishable. */
  public async findPublishableDraft(automationId: string): Promise<{
    draftVersionId: string;
    version: number;
    graph: AutomationDefinition;
    rawGraph?: string;
  } | null> {
    const row = await this.database.orm
      .select({
        draftVersionId: automationVersions.id,
        version: automationVersions.version,
        graph: automationVersions.graph,
      })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.draftVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(
        and(
          this.inWorkspace(automations),
          eq(automations.id, automationId),
          eq(automationVersions.status, "draft"),
        ),
      )
      .get();
    return row
      ? {
          ...row,
          graph: graphCodec.decode(row.graph),
          rawGraph: row.graph,
        }
      : null;
  }

  /** Of the given templates, those published locally and ready to send. */
  public async listPublishedTemplateIds(templateIds: string[]): Promise<string[]> {
    const rows = await this.database.orm
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(
        and(
          this.inWorkspace(emailTemplates),
          isNull(emailTemplates.archivedAt),
          eq(emailTemplates.purpose, "transactional"),
          isNotNull(emailTemplates.publishedRevision),
          inArray(emailTemplates.id, templateIds),
        ),
      );
    return rows.map((row) => row.id);
  }
}
