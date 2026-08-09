import { AutomationRepository, type OpenEngageDatabase } from "@openengage/database";

export interface AutomationAnalytics {
  enrollments: Array<{ status: string; count: number }>;
  deliveries: Array<{ status: string; count: number }>;
}

export async function getAutomationAnalytics(
  database: OpenEngageDatabase,
  workspaceId: string,
  automationId: string,
): Promise<AutomationAnalytics> {
  return new AutomationRepository(database, { workspaceId }).analytics(automationId);
}
