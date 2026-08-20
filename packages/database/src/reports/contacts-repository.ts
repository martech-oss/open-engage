import { sql } from "drizzle-orm";

import { contactTags, contacts, tags } from "../contacts/schema";
import { segmentMemberships, segments } from "../segments/schema";
import { ReportsBatchRepository } from "./batch-repository";
import type { ContactsSummaryData, ReportDateRange } from "./types";

export class ContactsReportsRepository extends ReportsBatchRepository {
  /** Summary, trend, top tags, and top static segments - 4 independent queries run concurrently. */
  public async contactsSummary(
    workspaceId: string,
    range: ReportDateRange,
  ): Promise<ContactsSummaryData> {
    const [summaryRows, trendRows, topTagRows, topSegmentRows] = await this.runBatch(
      sql`
        SELECT
          COUNT(*) AS total_contacts,
          COUNT(CASE WHEN ${contacts.status} = 'active' THEN 1 END) AS active_contacts,
          COUNT(CASE WHEN ${contacts.status} != 'active' THEN 1 END) AS inactive_contacts,
          COUNT(CASE WHEN ${contacts.status} = 'anonymous' THEN 1 END) AS anonymous_contacts,
          COUNT(CASE WHEN ${contacts.createdAt} >= ${range.fromTimestamp} AND ${contacts.createdAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS new_contacts,
          COUNT(CASE WHEN ${contacts.archivedAt} >= ${range.fromTimestamp} AND ${contacts.archivedAt} < ${range.toExclusiveTimestamp} THEN 1 END) AS archived_contacts
        FROM ${contacts}
        WHERE ${contacts.workspaceId} = ${workspaceId}
      `,
      sql`
        WITH contact_changes AS (
          SELECT date(${contacts.createdAt}) AS day, 1 AS added, 0 AS archived
          FROM ${contacts}
          WHERE ${contacts.workspaceId} = ${workspaceId} AND ${contacts.createdAt} >= ${range.fromTimestamp} AND ${contacts.createdAt} < ${range.toExclusiveTimestamp}
          UNION ALL
          SELECT date(${contacts.archivedAt}) AS day, 0 AS added, 1 AS archived
          FROM ${contacts}
          WHERE ${contacts.workspaceId} = ${workspaceId} AND ${contacts.archivedAt} >= ${range.fromTimestamp} AND ${contacts.archivedAt} < ${range.toExclusiveTimestamp}
        )
        SELECT day, SUM(added) AS added, SUM(archived) AS archived
        FROM contact_changes
        GROUP BY day
        ORDER BY day
      `,
      sql`
        SELECT ${tags.id}, ${tags.name}, ${tags.color},
               COUNT(${contacts.id}) AS contact_count
        FROM ${tags}
        LEFT JOIN ${contactTags}
          ON ${contactTags.workspaceId} = ${tags.workspaceId} AND ${contactTags.tagId} = ${tags.id}
        LEFT JOIN ${contacts}
          ON ${contacts.workspaceId} = ${contactTags.workspaceId} AND ${contacts.id} = ${contactTags.contactId}
             AND ${contacts.status} = 'active'
        WHERE ${tags.workspaceId} = ${workspaceId}
        GROUP BY ${tags.id}
        ORDER BY contact_count DESC, ${tags.name} ASC
        LIMIT 10
      `,
      sql`
        SELECT ${segments.id}, ${segments.name}, '#64748b' AS color,
               COUNT(CASE WHEN ${contacts.status} = 'active' THEN 1 END) AS contact_count
        FROM ${segments}
        LEFT JOIN ${segmentMemberships}
          ON ${segmentMemberships.workspaceId} = ${segments.workspaceId} AND ${segmentMemberships.segmentId} = ${segments.id}
            AND ${segmentMemberships.source} = 'static'
        LEFT JOIN ${contacts}
          ON ${contacts.workspaceId} = ${segmentMemberships.workspaceId} AND ${contacts.id} = ${segmentMemberships.contactId}
        WHERE ${segments.workspaceId} = ${workspaceId} AND ${segments.kind} = 'static'
        GROUP BY ${segments.id}
        ORDER BY contact_count DESC, ${segments.name} ASC
        LIMIT 10
      `,
    );
    return {
      summary: summaryRows[0] ?? {},
      trend: trendRows,
      topTags: topTagRows,
      topSegments: topSegmentRows,
    };
  }
}
