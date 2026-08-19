import type { OpenEngageDatabase } from "../client";
import { contactEventProjectionRows } from "../contacts/event-repository";
import { contactEventOutbox, contactEventProjections, contactEvents } from "../contacts/schema";
import { nowIso } from "../shared/database-utils";
import { uuidv7 } from "../shared/uuid";

export interface SiteMessageEventInput {
  contactId: string;
  visitorId: string;
  messageId: string;
  type: "impression" | "click";
}

/** Persists a site-message contact event with all durable projection work. */
export async function persistSiteMessageEvent(
  database: OpenEngageDatabase,
  workspaceId: string,
  input: SiteMessageEventInput,
): Promise<string> {
  const now = nowIso();
  const eventId = uuidv7();
  const orm = database.orm;
  await orm.batch([
    orm.insert(contactEvents).values({
      id: eventId,
      workspaceId,
      contactId: input.contactId,
      visitorId: input.visitorId,
      type: input.type === "impression" ? "site_message_viewed" : "site_message_clicked",
      resourceType: "site_message",
      resourceId: input.messageId,
      properties: "{}",
      occurredAt: now,
      createdAt: now,
    }),
    orm.insert(contactEventOutbox).values({
      eventId,
      workspaceId,
      status: "pending",
      createdAt: now,
    }),
    orm
      .insert(contactEventProjections)
      .values(contactEventProjectionRows({ id: eventId, workspaceId, createdAt: now })),
  ]);
  return eventId;
}
