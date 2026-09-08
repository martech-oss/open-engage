import { sql, type SQL } from "drizzle-orm";

import type { OpenEngageDatabase } from "../client";
import { CONTACT_EVENT_PROJECTIONS } from "../contacts/event-repository";
import { contactEvents, contactEventOutbox, contactEventProjections } from "../contacts/schema";
import { uuidv7 } from "../shared/uuid";

/** candidates supplies id and type. Membership and its durable events share the caller's batch. */
export function membershipEventStatements(
  database: OpenEngageDatabase,
  input: { workspaceId: string; segmentId: string; now: string; candidates: SQL },
) {
  const prefix = `${uuidv7()}:`,
    workspaceId = input.workspaceId,
    orm = database.orm;
  const generated = sql`e.workspace_id=${workspaceId} AND e.id>=${prefix} AND e.id<${prefix + "~"}`;
  return {
    candidates: sql`SELECT e.contact_id AS id,e.type FROM contact_events e WHERE ${generated}`,
    statements: [
      orm
        .insert(contactEvents)
        .select(
          sql`SELECT ${prefix}||c.type||':'||c.id,${workspaceId},c.id,NULL,'live',c.type,'segment',${input.segmentId},'{}',${input.now},NULL,${input.now} FROM (${input.candidates}) c`,
        ),
      orm
        .insert(contactEventOutbox)
        .select(
          sql`SELECT e.id,${workspaceId},'pending',0,NULL,NULL,NULL,NULL,${input.now},NULL FROM contact_events e WHERE ${generated}`,
        ),
      orm
        .insert(contactEventProjections)
        .select(
          sql`SELECT e.id,${workspaceId},p.value,'pending',${input.now},NULL FROM contact_events e,json_each(${JSON.stringify(CONTACT_EVENT_PROJECTIONS)}) p WHERE ${generated}`,
        ),
    ] as const,
  };
}
