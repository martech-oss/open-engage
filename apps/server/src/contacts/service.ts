import type {
  Contact,
  ContactCreate,
  ContactListInput,
  ContactListResult,
  ContactSummary,
  ContactTimelineEvent,
} from "@openengage/core/contacts";
import type { WorkspaceContext } from "@openengage/core/shared";
import {
  ContactRepository,
  ContactResourceRepository,
  type OpenEngageDatabase,
} from "@openengage/database";

import { recordContactEvent } from "../contacts/event-service";

export async function listContacts(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: ContactListInput,
): Promise<ContactListResult> {
  const repository = new ContactRepository(database, workspace);
  const page = await repository.listContacts(input);
  const items = await attachContactRelations(database, workspace.workspaceId, page.items);

  return {
    items,
    total: page.total,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

export async function createContact(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: ContactCreate,
  queue?: Queue,
): Promise<Contact> {
  const repository = new ContactRepository(database, workspace);
  const contact = await repository.createContact(input);
  await recordContactEvent(database, {
    workspaceId: workspace.workspaceId,
    contactId: contact.id,
    type: "contact_created",
    resourceType: "contact",
    resourceId: contact.id,
    ...(queue ? { queue } : {}),
  });
  return contact;
}

export async function getContactTimeline(
  database: OpenEngageDatabase,
  workspaceId: string,
  contactId: string,
): Promise<ContactTimelineEvent[] | null> {
  const repository = new ContactResourceRepository(database, { workspaceId });
  if (!(await repository.contactExists(contactId))) return null;
  return repository.listContactEvents(contactId, 200);
}

export type ContactEventOutcome =
  | { kind: "contact_not_found" }
  | { kind: "recorded"; eventId: string; enrollmentCount: number };

export async function recordContactApiEvent(
  database: OpenEngageDatabase,
  workspaceId: string,
  input: {
    contactId: string;
    eventName: string;
    source: "api" | "webhook";
    properties: Record<string, unknown>;
    occurredAt?: string;
  },
  queue?: Queue,
): Promise<ContactEventOutcome> {
  const contactId = await new ContactResourceRepository(database, {
    workspaceId,
  }).findActiveContactId(input.contactId);
  if (!contactId) return { kind: "contact_not_found" };
  const result = await recordContactEvent(database, {
    workspaceId,
    contactId,
    type: input.source === "webhook" ? "webhook_event" : "custom_event",
    resourceType: input.source,
    resourceId: input.eventName,
    properties: input.properties,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    ...(queue ? { queue } : {}),
  });
  return { kind: "recorded", ...result };
}

async function attachContactRelations(
  database: OpenEngageDatabase,
  workspaceId: string,
  contacts: Contact[],
): Promise<ContactSummary[]> {
  if (contacts.length === 0) return [];
  const ids = contacts.map((contact) => contact.id);
  const relations = await new ContactResourceRepository(database, {
    workspaceId,
  }).listContactRelations(ids);
  const tagsByContact = new Map<string, ContactSummary["tags"]>();
  const companiesByContact = new Map<string, ContactSummary["companies"]>();

  for (const row of relations.tags) {
    const items = tagsByContact.get(row.contactId) ?? [];
    items.push({ id: row.id, name: row.name, slug: row.slug, color: row.color });
    tagsByContact.set(row.contactId, items);
  }

  for (const row of relations.accounts) {
    const items = companiesByContact.get(row.contactId) ?? [];
    items.push({
      id: row.id,
      name: row.name,
      domain: row.domain,
      title: row.title,
      is_primary: row.isPrimary,
    });
    companiesByContact.set(row.contactId, items);
  }

  return contacts.map((contact) => ({
    ...contact,
    tags: tagsByContact.get(contact.id) ?? [],
    companies: companiesByContact.get(contact.id) ?? [],
  }));
}
