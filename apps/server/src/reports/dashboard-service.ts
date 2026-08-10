import type { Dashboard } from "@openengage/core/reports";
import { ReportsRepository, type OpenEngageDatabase } from "@openengage/database";

import { toFiniteNumber, parseJsonRecord, primitiveString } from "../platform/values";

export async function getDashboard(
  database: OpenEngageDatabase,
  workspaceId: string,
): Promise<Dashboard> {
  const data = await new ReportsRepository(database).dashboardSummary(workspaceId);
  return {
    contacts: { count: toFiniteNumber(data.contacts["count"]) },
    automations: { count: toFiniteNumber(data.automations["count"]) },
    briefs: { overdueReviews: toFiniteNumber(data.briefs["overdue_reviews"]) },
    deliveries: {
      sent: toFiniteNumber(data.deliveries["sent"]),
      delivered: toFiniteNumber(data.deliveries["delivered"]),
      failed: toFiniteNumber(data.deliveries["failed"]),
    },
    recentEvents: data.events.map((row) => ({
      type: primitiveString(row["type"]),
      occurredAt: primitiveString(row["occurred_at"]),
      contactId: row["contact_id"] === null ? null : primitiveString(row["contact_id"]),
      properties: parseJsonRecord(row["properties"]),
    })),
  };
}
