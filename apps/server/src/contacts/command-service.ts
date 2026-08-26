import type { Contact, ContactCreate, ContactUpdate } from "@openengage/core/contacts";
import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";
import {
  ContactRelationInvalidError,
  ContactRepository,
  type InitialContactRelationField,
} from "@openengage/database/contacts";
import { isUniqueConstraintError } from "@openengage/database/shared";

const CONTACT_EMAIL_UNIQUE_COLUMNS = ["contacts.workspace_id", "contacts.email"] as const;
const CONTACT_EXTERNAL_ID_UNIQUE_COLUMNS = [
  "contacts.workspace_id",
  "contacts.external_id",
] as const;

export interface ContactCreateCommand extends ContactCreate {
  tagId?: string | undefined;
  segmentId?: string | undefined;
  companyId?: string | undefined;
}

export type ContactUpdateCommand = ContactUpdate & { id: string };

type ContactCreatePersistenceOutcome =
  | { kind: "contact_conflict"; cause: unknown }
  | {
      kind: "contact_relation_invalid";
      field: InitialContactRelationField;
      cause: unknown;
    }
  | { kind: "ok"; contact: Contact; eventId: string };

export interface ContactCommandPersistencePort {
  create(input: ContactCreateCommand): Promise<ContactCreatePersistenceOutcome>;
  find(id: string): Promise<Contact | null>;
  update(id: string, changes: ContactUpdate): Promise<Contact | null>;
  archive(id: string): Promise<boolean>;
}

export interface ContactCommandPorts {
  persistence: ContactCommandPersistencePort;
  processCreatedEvent(eventId: string): Promise<void>;
  reconcileContact(contactId: string): Promise<void>;
  writeAudit(input: {
    action: "contact.create";
    resourceType: "contact";
    resourceId: string;
  }): Promise<void>;
  defer(promise: Promise<unknown>): void;
}

export type ContactCreateOutcome =
  | Exclude<ContactCreatePersistenceOutcome, { kind: "ok" }>
  | { kind: "ok"; contact: Contact };

export type ContactUpdateOutcome =
  | { kind: "contact_not_found" }
  | { kind: "contact_archived" }
  | { kind: "ok"; contact: Contact };

export type ContactArchiveOutcome = { kind: "contact_not_found" } | { kind: "ok" };

export class ContactCommandService {
  public constructor(private readonly ports: ContactCommandPorts) {}

  public async create(input: ContactCreateCommand): Promise<ContactCreateOutcome> {
    const persisted = await this.ports.persistence.create(input);
    if (persisted.kind !== "ok") return persisted;

    await this.ports.processCreatedEvent(persisted.eventId);
    this.ports.defer(
      this.ports.writeAudit({
        action: "contact.create",
        resourceType: "contact",
        resourceId: persisted.contact.id,
      }),
    );
    return { kind: "ok", contact: persisted.contact };
  }

  public async update(input: ContactUpdateCommand): Promise<ContactUpdateOutcome> {
    const { id, ...changes } = input;
    const existing = await this.ports.persistence.find(id);
    if (!existing) return { kind: "contact_not_found" };
    if (existing.status === "archived") return { kind: "contact_archived" };

    const contact = await this.ports.persistence.update(id, changes);
    if (!contact) return { kind: "contact_not_found" };
    await this.ports.reconcileContact(id);
    return { kind: "ok", contact };
  }

  public async archive(id: string): Promise<ContactArchiveOutcome> {
    if (!(await this.ports.persistence.archive(id))) return { kind: "contact_not_found" };
    await this.ports.reconcileContact(id);
    return { kind: "ok" };
  }
}

export function createContactCommandPersistence(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): ContactCommandPersistencePort {
  const repository = new ContactRepository(database, workspace);
  return {
    create: async (command) => {
      const { tagId, segmentId, companyId, ...contactInput } = command;
      try {
        const created = await repository.createContactWithInitialRelations(contactInput, {
          ...(tagId ? { tagId } : {}),
          ...(segmentId ? { segmentId } : {}),
          ...(companyId ? { companyId } : {}),
        });
        return { kind: "ok", ...created };
      } catch (error) {
        if (error instanceof ContactRelationInvalidError) {
          return { kind: "contact_relation_invalid", field: error.field, cause: error };
        }
        if (
          isUniqueConstraintError(error, CONTACT_EMAIL_UNIQUE_COLUMNS) ||
          isUniqueConstraintError(error, CONTACT_EXTERNAL_ID_UNIQUE_COLUMNS)
        ) {
          return { kind: "contact_conflict", cause: error };
        }
        throw error;
      }
    },
    find: (id) => repository.getContact(id),
    update: (id, changes) => repository.updateContact(id, changes),
    archive: (id) => repository.archiveContact(id),
  };
}
