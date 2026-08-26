import type {
  Contact,
  ContactListInput,
  ContactListResult,
  ContactSummary,
  ContactTimelineEvent,
} from "@openengage/core/contacts";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import { ContactRepository, ContactResourceRepository } from "@openengage/database/contacts";

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

export async function getContact(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<Contact | null> {
  return new ContactRepository(database, workspace).getContact(id);
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

export interface ContactApiEventInput {
  contactId: string;
  eventName: string;
  source: "api" | "webhook";
  properties: Record<string, unknown>;
  occurredAt?: string;
}

export interface ContactApiEventRecord {
  workspaceId: string;
  contactId: string;
  type: "custom_event" | "webhook_event";
  resourceType: "api" | "webhook";
  resourceId: string;
  properties: Record<string, unknown>;
  occurredAt?: string;
}

export interface ContactApiEventPorts {
  findActiveContactId(contactId: string): Promise<string | null>;
  recordEvent(input: ContactApiEventRecord): Promise<{ eventId: string; enrollmentCount: number }>;
}

export async function recordContactApiEvent(
  workspaceId: string,
  input: ContactApiEventInput,
  ports: ContactApiEventPorts,
): Promise<ContactEventOutcome> {
  const contactId = await ports.findActiveContactId(input.contactId);
  if (!contactId) return { kind: "contact_not_found" };
  const result = await ports.recordEvent({
    workspaceId,
    contactId,
    type: input.source === "webhook" ? "webhook_event" : "custom_event",
    resourceType: input.source,
    resourceId: input.eventName,
    properties: input.properties,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
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
