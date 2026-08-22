import { and, eq, exists, gte, lte, or, sql, type SQL } from "drizzle-orm";

import type { ContactExportFilter } from "@openengage/core/contacts";

import type { OpenEngageDatabase } from "../client";
import { segmentMemberships } from "../segments/schema";
import { likeContains } from "../shared/database-utils";
import { companyContacts, contacts, contactTags } from "./schema";

/** The single database predicate used by both contact listing and job exports. */
export function buildContactFilterPredicate(
  database: OpenEngageDatabase,
  workspaceId: string,
  filter: ContactExportFilter,
): SQL {
  const conditions: SQL[] = [eq(contacts.workspaceId, workspaceId)];
  if (filter.query) {
    conditions.push(
      or(
        likeContains(contacts.email, filter.query),
        likeContains(contacts.firstName, filter.query),
        likeContains(contacts.lastName, filter.query),
        likeContains(contacts.phone, filter.query),
        likeContains(contacts.externalId, filter.query),
      )!,
    );
  }
  if (filter.status && filter.status !== "all") {
    conditions.push(eq(contacts.status, filter.status));
  }
  if (filter.stage) conditions.push(eq(contacts.stage, filter.stage));
  if (filter.scoreMin !== undefined) conditions.push(gte(contacts.score, filter.scoreMin));
  if (filter.scoreMax !== undefined) conditions.push(lte(contacts.score, filter.scoreMax));
  if (filter.tagId) {
    conditions.push(
      exists(
        database.orm
          .select({ value: sql`1` })
          .from(contactTags)
          .where(
            and(
              eq(contactTags.workspaceId, contacts.workspaceId),
              eq(contactTags.contactId, contacts.id),
              eq(contactTags.tagId, filter.tagId),
            ),
          ),
      ),
    );
  }
  if (filter.companyId) {
    conditions.push(
      exists(
        database.orm
          .select({ value: sql`1` })
          .from(companyContacts)
          .where(
            and(
              eq(companyContacts.workspaceId, contacts.workspaceId),
              eq(companyContacts.contactId, contacts.id),
              eq(companyContacts.companyId, filter.companyId),
            ),
          ),
      ),
    );
  }
  if (filter.segmentId) {
    conditions.push(
      exists(
        database.orm
          .select({ value: sql`1` })
          .from(segmentMemberships)
          .where(
            and(
              eq(segmentMemberships.workspaceId, contacts.workspaceId),
              eq(segmentMemberships.contactId, contacts.id),
              eq(segmentMemberships.segmentId, filter.segmentId),
            ),
          ),
      ),
    );
  }
  return and(...conditions)!;
}
