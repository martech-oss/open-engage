import { and, eq, inArray } from "drizzle-orm";

import { deliveries } from "../messaging/schema";
import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { contacts } from "./schema";

export class ContactStateRepository extends WorkspaceRepository {
  /** Archives or restores many contacts at once, regardless of current status. */
  /** Archiving also scrubs the plaintext email off those contacts' email deliveries (see archiveContact). */
  public async bulkSetContactsArchived(contactIds: string[], archived: boolean): Promise<number> {
    const now = nowIso();
    const orm = this.database.orm;
    const contactsUpdate = orm
      .update(contacts)
      .set({
        status: archived ? "archived" : "active",
        archivedAt: archived ? now : null,
        updatedAt: now,
      })
      .where(and(this.inWorkspace(contacts), inArray(contacts.id, contactIds)));
    if (!archived) {
      const result = await contactsUpdate;
      return result.meta.changes;
    }
    const [result] = await orm.batch([
      contactsUpdate,
      orm
        .update(deliveries)
        .set({ recipient: null })
        .where(
          and(
            this.inWorkspace(deliveries),
            inArray(deliveries.contactId, contactIds),
            eq(deliveries.channel, "email"),
          ),
        ),
    ]);
    return result.meta.changes;
  }
}
