import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";

import { DatabaseRepository } from "../shared/repository-base";
import { automations, automationVersions, automationRuns } from "./schema";

export class AutomationRunRecoveryRepository extends DatabaseRepository {
  public async scheduled(limit = 100, afterAutomationId?: string) {
    return this.database.orm
      .select({
        workspaceId: automations.workspaceId,
        automationId: automations.id,
        versionId: automationVersions.id,
        graph: automationVersions.graph,
        publishedAt: automationVersions.publishedAt,
      })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.publishedVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(
        and(
          eq(automations.status, "active"),
          ...(afterAutomationId ? [gt(automations.id, afterAutomationId)] : []),
          sql`EXISTS(SELECT 1 FROM json_each(${automationVersions.graph},'$.nodes') n WHERE json_extract(n.value,'$.config.source')='batch' AND json_extract(n.value,'$.config.schedule.kind')!='now')`,
        ),
      )
      .orderBy(asc(automations.id))
      .limit(limit);
  }
  public async recoverable(limit = 100) {
    return this.database.orm
      .select({ id: automationRuns.id, workspaceId: automationRuns.workspaceId })
      .from(automationRuns)
      .where(inArray(automationRuns.status, ["enrolling", "running"]))
      .orderBy(asc(automationRuns.updatedAt))
      .limit(limit);
  }
  public async latestSlot(workspaceId: string, automationId: string) {
    const row = await this.database.orm
      .select({ slot: automationRuns.slot })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.workspaceId, workspaceId),
          eq(automationRuns.automationId, automationId),
          sql`${automationRuns.slot} NOT LIKE 'manual:%'`,
        ),
      )
      .orderBy(desc(automationRuns.slot))
      .limit(1)
      .get();
    return row?.slot;
  }
}
