import { ContactsReportsRepository } from "@openengage/database/reports";

import { primitiveString, toFiniteNumber } from "../platform/values";
import { publicRange, type ReportDatabase, type ReportRange } from "./shared";

export async function contactReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const data = await new ContactsReportsRepository(database).contactsSummary(workspaceId, range);
  const summary = data.summary;
  return {
    category: "contacts" as const,
    range: publicRange(range),
    summary: {
      totalContacts: toFiniteNumber(summary["total_contacts"]),
      activeContacts: toFiniteNumber(summary["active_contacts"]),
      inactiveContacts: toFiniteNumber(summary["inactive_contacts"]),
      anonymousContacts: toFiniteNumber(summary["anonymous_contacts"]),
      newContacts: toFiniteNumber(summary["new_contacts"]),
      archivedContacts: toFiniteNumber(summary["archived_contacts"]),
    },
    trend: data.trend.map((row) => ({
      day: primitiveString(row["day"]),
      added: toFiniteNumber(row["added"]),
      archived: toFiniteNumber(row["archived"]),
    })),
    topTags: data.topTags.map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      color: primitiveString(row["color"]),
      contactCount: toFiniteNumber(row["contact_count"]),
    })),
    topSegments: data.topSegments.map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      color: primitiveString(row["color"]),
      contactCount: toFiniteNumber(row["contact_count"]),
    })),
  };
}
