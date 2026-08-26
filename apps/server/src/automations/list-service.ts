import type { AutomationDraft, AutomationRow } from "@openengage/core/automations";
import type { WorkspaceContext } from "@openengage/core/shared";
import { AutomationRepository } from "@openengage/database/automations";
import { type OpenEngageDatabase } from "@openengage/database/client";

import { getAutomationPublishability } from "./publishability-service";

export async function listAutomations(
  database: OpenEngageDatabase,
  workspaceId: string,
): Promise<AutomationRow[]> {
  const repository = new AutomationRepository(database, { workspaceId });
  const rows = await repository.listAutomationsWithCounts();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: normalizeAutomationStatus(row.status),
    triggerSource: row.triggerSource,
    enrollmentCount: row.enrollmentCount,
    activeCount: row.activeCount,
    completedCount: row.completedCount,
    updatedAt: row.updatedAt,
  }));
}

export async function getAutomationDraft(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<AutomationDraft | null> {
  const row = await new AutomationRepository(database, workspace).getDraft(id);
  if (!row) return null;
  return {
    graph: row.graph,
    status: normalizeAutomationStatus(row.status),
    publishability: await getAutomationPublishability(database, workspace, row.graph),
  };
}

export function normalizeAutomationStatus(value: unknown): AutomationRow["status"] {
  return value === "active" || value === "paused" || value === "archived" ? value : "draft";
}
