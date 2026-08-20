import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

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
    // Correlated subqueries are embedded as builders: interpolating a plain
    // `${table.column}` into a select field renders it unqualified, which
    // would silently self-compare inside the subquery.
    const triggerSourceQuery = this.database.orm
      .select({ source: automationTriggers.source })
      .from(automationTriggers)
      .where(
        and(
          eq(automationTriggers.workspaceId, automations.workspaceId),
          eq(automationTriggers.automationVersionId, automations.publishedVersionId),
        ),
      );
    return await this.database.orm
      .select({
        id: automations.id,
        name: automations.name,
        description: automations.description,
        status: automations.status,
        triggerSource: sql<string | null>`${triggerSourceQuery}`.as("trigger_source"),
        enrollmentCount: this.enrollmentCountExpression().as("enrollment_count"),
        activeCount: this.enrollmentCountExpression("active").as("active_count"),
        completedCount: this.enrollmentCountExpression("completed").as("completed_count"),
        updatedAt: automations.updatedAt,
      })
      .from(automations)
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
  public async findPublishableDraft(
    automationId: string,
  ): Promise<{ draftVersionId: string; version: number; graph: AutomationDefinition } | null> {
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

  /** COUNT of this automation's enrollments, optionally narrowed to one status. */
  private enrollmentCountExpression(status?: "active" | "completed") {
    const conditions = [
      eq(automationEnrollments.workspaceId, automations.workspaceId),
      eq(automationEnrollments.automationId, automations.id),
    ];
    if (status) conditions.push(eq(automationEnrollments.status, status));
    return sql<number>`${this.database.orm.$count(automationEnrollments, and(...conditions))}`.mapWith(
      Number,
    );
  }
}
