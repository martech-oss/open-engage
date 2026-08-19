import type { AutomationRow } from "@openengage/core/automations";
import { AutomationRepository } from "@openengage/database/automations";
import { type OpenEngageDatabase } from "@openengage/database/client";

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

export function normalizeAutomationStatus(value: unknown): AutomationRow["status"] {
  return value === "active" || value === "paused" || value === "archived" ? value : "draft";
}
