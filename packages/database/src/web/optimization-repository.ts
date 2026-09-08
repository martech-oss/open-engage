import { and, desc, eq, isNull, or, gt, sql } from "drizzle-orm";

import {
  dynamicContentSchema,
  experimentSchema,
  type DynamicContentWrite,
  type ExperimentWrite,
} from "@openengage/core/web";

import { reportDaysCte } from "../reports/batch-repository";
import type { ReportDateRange } from "../reports/types";
import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { dynamicContents, experimentExposures, landingExperiments } from "./optimization-schema";
import { landingPages } from "./schema";

export class OptimizationRepository extends WorkspaceRepository {
  async experiments(pageId: string) {
    const rows = await this.database.orm
      .select()
      .from(landingExperiments)
      .where(and(this.inWorkspace(landingExperiments), eq(landingExperiments.pageId, pageId)))
      .orderBy(desc(landingExperiments.createdAt));
    return rows.map((row) =>
      experimentSchema.parse({ ...row, variants: JSON.parse(row.variants) }),
    );
  }
  async experiment(id: string) {
    const row = await this.database.orm
      .select()
      .from(landingExperiments)
      .where(and(this.inWorkspace(landingExperiments), eq(landingExperiments.id, id)))
      .get();
    return row ? experimentSchema.parse({ ...row, variants: JSON.parse(row.variants) }) : null;
  }
  async createExperiment(input: ExperimentWrite) {
    const old = await this.experiment(input.id);
    if (old)
      return (
        old.pageId === input.pageId &&
        old.name === input.name &&
        JSON.stringify(old.variants) === JSON.stringify(input.variants)
      );
    const row = await this.database.orm
      .insert(landingExperiments)
      .values({
        ...input,
        workspaceId: this.context.workspaceId,
        variants: JSON.stringify(input.variants),
        createdAt: nowIso(),
      })
      .onConflictDoNothing()
      .returning()
      .get();
    return Boolean(row);
  }
  async start(id: string) {
    const row = await this.database.orm
      .update(landingExperiments)
      .set({ status: "running", startedAt: nowIso() })
      .where(
        and(
          this.inWorkspace(landingExperiments),
          eq(landingExperiments.id, id),
          eq(landingExperiments.status, "draft"),
        ),
      )
      .returning()
      .get();
    return Boolean(row) || (await this.experiment(id))?.status === "running";
  }
  async end(id: string, winnerVariantId: string | null, expectedPublishedVersionId: string) {
    const experiment = await this.experiment(id);
    if (!experiment) return false;
    if (experiment.status === "ended") return experiment.winnerVariantId === winnerVariantId;
    if (experiment.status !== "running") return false;
    const winner = winnerVariantId
      ? experiment.variants.find((variant) => variant.id === winnerVariantId)
      : null;
    if (winnerVariantId && !winner) return false;
    const now = nowIso();
    const end = this.database.orm
      .update(landingExperiments)
      .set({ status: "ended", winnerVariantId, endedAt: now })
      .where(
        and(
          this.inWorkspace(landingExperiments),
          eq(landingExperiments.id, id),
          eq(landingExperiments.status, "running"),
        ),
      );
    if (!winner) {
      if (await end.returning({ id: landingExperiments.id }).get()) return true;
      const completed = await this.experiment(id);
      return completed?.status === "ended" && completed.winnerVariantId === null;
    }
    await this.database.orm.batch([
      this.database.orm
        .update(landingPages)
        .set({
          publishedVersionId: winner.pageVersionId,
          updatedAt: now,
          name: sql`CASE WHEN ${landingPages.publishedVersionId}=${expectedPublishedVersionId} AND ${landingPages.status}='published' AND EXISTS(SELECT 1 FROM landing_experiments WHERE id=${id} AND workspace_id=${this.context.workspaceId} AND status='running') THEN ${landingPages.name} ELSE NULL END`,
        })
        .where(and(this.inWorkspace(landingPages), eq(landingPages.id, experiment.pageId))),
      end,
    ]);
    return true;
  }
  async assignment(experimentId: string, visitorId: string) {
    return this.database.orm
      .select()
      .from(experimentExposures)
      .where(
        and(
          this.inWorkspace(experimentExposures),
          eq(experimentExposures.experimentId, experimentId),
          eq(experimentExposures.visitorId, visitorId),
        ),
      )
      .get();
  }
  async assign(input: {
    experimentId: string;
    visitorId: string;
    variantId: string;
    pageVersionId: string;
  }) {
    const id = crypto.randomUUID(),
      now = nowIso();
    await this.database.orm
      .run(sql`INSERT INTO experiment_exposures(id,workspace_id,experiment_id,visitor_id,variant_id,page_version_id,created_at)
      SELECT ${id},${this.context.workspaceId},${input.experimentId},${input.visitorId},${input.variantId},${input.pageVersionId},${now}
      WHERE EXISTS(SELECT 1 FROM landing_experiments e,json_each(e.variants) v WHERE e.workspace_id=${this.context.workspaceId} AND e.id=${input.experimentId} AND e.status='running' AND json_extract(v.value,'$.id')=${input.variantId} AND json_extract(v.value,'$.pageVersionId')=${input.pageVersionId}) ON CONFLICT DO NOTHING`);
    return this.assignment(input.experimentId, input.visitorId);
  }
  async expose(input: ExposureIdentity, occurredAt: string) {
    await this.database.orm
      .update(experimentExposures)
      .set({
        exposedAt: occurredAt,
        convertedAt: sql`(
      SELECT MIN(candidate) FROM (
      SELECT ${experimentExposures.convertedAt} AS candidate WHERE ${experimentExposures.convertedAt}>=${occurredAt} AND julianday(${experimentExposures.convertedAt})<=julianday(${occurredAt})+30
      UNION ALL SELECT e.occurred_at AS candidate FROM contact_events e
      WHERE e.workspace_id=${this.context.workspaceId} AND e.visitor_id=${input.visitorId} AND e.type='form_submitted'
        AND json_extract(e.properties,'$.exposureId')=${input.exposureId} AND json_extract(e.properties,'$.pageVersionId')=${input.pageVersionId}
        AND e.occurred_at>=${occurredAt} AND julianday(e.occurred_at)<=julianday(${occurredAt})+30
      )
    )`,
      })
      .where(
        and(
          this.inWorkspace(experimentExposures),
          eq(experimentExposures.id, input.exposureId),
          eq(experimentExposures.visitorId, input.visitorId),
          eq(experimentExposures.pageVersionId, input.pageVersionId),
          or(isNull(experimentExposures.exposedAt), gt(experimentExposures.exposedAt, occurredAt)),
          sql`EXISTS(SELECT 1 FROM landing_experiments WHERE id=${experimentExposures.experimentId} AND workspace_id=${this.context.workspaceId} AND started_at<=${occurredAt} AND (ended_at IS NULL OR ended_at>=${occurredAt}))`,
        ),
      );
  }
  async convert(input: ExposureIdentity, occurredAt: string) {
    await this.database.orm
      .update(experimentExposures)
      .set({ convertedAt: occurredAt })
      .where(
        and(
          this.inWorkspace(experimentExposures),
          eq(experimentExposures.id, input.exposureId),
          eq(experimentExposures.visitorId, input.visitorId),
          eq(experimentExposures.pageVersionId, input.pageVersionId),
          isNull(experimentExposures.convertedAt),
          sql`${experimentExposures.exposedAt} <= ${occurredAt} AND julianday(${occurredAt}) <= julianday(${experimentExposures.exposedAt}) + 30`,
        ),
      );
  }
  async report(id: string, range: ReportDateRange, asOf: string) {
    return this.database.orm.all<{
      day: string;
      variantId: string;
      visitors: number;
      conversions: number;
      pendingVisitors: number;
    }>(sql`WITH ${reportDaysCte(range)}
      SELECT d.day,e.variant_id AS variantId,COUNT(*) AS visitors,COUNT(CASE WHEN e.converted_at<=${asOf} THEN 1 END) AS conversions,
      SUM(CASE WHEN julianday(${asOf})<julianday(e.exposed_at)+30 THEN 1 ELSE 0 END) AS pendingVisitors
      FROM report_days d JOIN experiment_exposures e ON e.exposed_at>=d.from_timestamp AND e.exposed_at<d.to_exclusive_timestamp
      WHERE e.workspace_id=${this.context.workspaceId} AND e.experiment_id=${id} AND e.exposed_at<=${asOf} GROUP BY d.day,e.variant_id ORDER BY d.day,e.variant_id`);
  }
  async dynamic(pageId: string) {
    const rows = await this.database.orm
      .select()
      .from(dynamicContents)
      .where(and(this.inWorkspace(dynamicContents), eq(dynamicContents.pageId, pageId)));
    return rows.map((row) => dynamicContentSchema.parse({ ...row, rules: JSON.parse(row.rules) }));
  }
  async saveDynamic(input: DynamicContentWrite) {
    await this.database.orm
      .insert(dynamicContents)
      .values({
        ...input,
        workspaceId: this.context.workspaceId,
        rules: JSON.stringify(input.rules),
        updatedAt: nowIso(),
      })
      .onConflictDoUpdate({
        target: [dynamicContents.workspaceId, dynamicContents.pageId, dynamicContents.slotId],
        set: {
          fallbackHtml: input.fallbackHtml,
          rules: JSON.stringify(input.rules),
          updatedAt: nowIso(),
        },
      });
  }
  async matchesSegments(contactId: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.database.orm.all<{ id: string }>(
      sql`SELECT s.id FROM segments s JOIN segment_memberships m ON m.segment_id=s.id AND m.workspace_id=s.workspace_id JOIN contacts c ON c.workspace_id=m.workspace_id AND c.id=m.contact_id WHERE s.workspace_id=${this.context.workspaceId} AND m.contact_id=${contactId} AND c.status='active' AND s.id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
    );
    return new Set(rows.map((row) => row.id));
  }
  async validSegment(id: string) {
    return Boolean(
      await this.database.orm.get(
        sql`SELECT id FROM segments WHERE workspace_id=${this.context.workspaceId} AND id=${id}`,
      ),
    );
  }
}
export interface ExposureIdentity {
  visitorId: string;
  exposureId: string;
  pageVersionId: string;
}
