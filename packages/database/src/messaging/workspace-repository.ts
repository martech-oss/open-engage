import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import {
  emailDocumentV2Schema,
  emailTemplateSchema,
  messageVariableSchema,
  type EmailDocumentV2,
  type EmailPurpose,
  type EmailTemplate,
  type MessageVariable,
} from "@openengage/core/messaging";

import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { emailTemplates, messageVariables } from "./schema";

const emailTemplateSelection = {
  id: emailTemplates.id,
  name: emailTemplates.name,
  purpose: emailTemplates.purpose,
  draftSubject: emailTemplates.draftSubject,
  draftContent: emailTemplates.draftContent,
  draftRevision: emailTemplates.draftRevision,
  publishedSubject: emailTemplates.publishedSubject,
  publishedContent: emailTemplates.publishedContent,
  publishedRevision: emailTemplates.publishedRevision,
  publishedAt: emailTemplates.publishedAt,
  archivedAt: emailTemplates.archivedAt,
  createdAt: emailTemplates.createdAt,
  updatedAt: emailTemplates.updatedAt,
};

const draftContentCodec = defineJsonCodec(emailDocumentV2Schema, "email_templates.draft_content");
function toEmailTemplate(row: {
  id: string;
  name: string;
  purpose: string;
  draftSubject: string;
  draftContent: string;
  draftRevision: number;
  publishedRevision: number | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}): EmailTemplate {
  return emailTemplateSchema.parse({
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    subject: row.draftSubject,
    content: draftContentCodec.decode(row.draftContent),
    draftRevision: row.draftRevision,
    publishedRevision: row.publishedRevision,
    hasUnpublishedChanges: row.publishedRevision !== row.draftRevision,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sendable: row.purpose === "transactional" && row.publishedRevision !== null && !row.archivedAt,
  });
}

/** Admin-facing queries for email templates and message variables. */
export class MessagingRepository extends WorkspaceRepository {
  public async getEmailTemplatesByIds(ids: string[]): Promise<EmailTemplate[]> {
    if (ids.length === 0) return [];
    const rows = await this.database.orm
      .select(emailTemplateSelection)
      .from(emailTemplates)
      .where(and(this.inWorkspace(emailTemplates), inArray(emailTemplates.id, ids)));
    return rows.map(toEmailTemplate);
  }

  public async getEmailTemplate(id: string): Promise<EmailTemplate | null> {
    const [row] = await this.database.orm
      .select(emailTemplateSelection)
      .from(emailTemplates)
      .where(and(this.inWorkspace(emailTemplates), eq(emailTemplates.id, id)))
      .limit(1);
    return row ? toEmailTemplate(row) : null;
  }

  public async listEmailTemplates(archived: boolean): Promise<EmailTemplate[]> {
    const rows = await this.database.orm
      .select(emailTemplateSelection)
      .from(emailTemplates)
      .where(
        and(
          this.inWorkspace(emailTemplates),
          archived ? isNotNull(emailTemplates.archivedAt) : isNull(emailTemplates.archivedAt),
        ),
      )
      .orderBy(desc(emailTemplates.updatedAt))
      .limit(UNPAGINATED_LIST_LIMIT);
    return rows.map(toEmailTemplate);
  }

  public async createEmailTemplate(input: {
    name: string;
    purpose: EmailPurpose;
    subject: string;
    content: EmailDocumentV2;
  }): Promise<{ id: string }> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(emailTemplates).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      purpose: input.purpose,
      draftSubject: input.subject,
      draftContent: draftContentCodec.encode(input.content),
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async updateEmailTemplate(
    id: string,
    input: { name: string; subject: string; content: EmailDocumentV2 },
  ): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(emailTemplates)
      .set({
        name: input.name,
        draftSubject: input.subject,
        draftContent: draftContentCodec.encode(input.content),
        draftRevision: sql`${emailTemplates.draftRevision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          this.inWorkspace(emailTemplates),
          eq(emailTemplates.id, id),
          isNull(emailTemplates.archivedAt),
        ),
      );
    return changedExactlyOne(result);
  }

  public async publishEmailTemplate(id: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(emailTemplates)
      .set({
        publishedSubject: emailTemplates.draftSubject,
        publishedContent: emailTemplates.draftContent,
        publishedRevision: emailTemplates.draftRevision,
        publishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          this.inWorkspace(emailTemplates),
          eq(emailTemplates.id, id),
          isNull(emailTemplates.archivedAt),
        ),
      );
    return changedExactlyOne(result);
  }

  public async archiveEmailTemplate(id: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(emailTemplates)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          this.inWorkspace(emailTemplates),
          eq(emailTemplates.id, id),
          isNull(emailTemplates.archivedAt),
        ),
      );
    return changedExactlyOne(result);
  }

  public async listMessageVariables(archived: boolean): Promise<MessageVariable[]> {
    const rows = await this.database.orm
      .select({
        id: messageVariables.id,
        key: messageVariables.key,
        name: messageVariables.name,
        value: messageVariables.value,
        description: messageVariables.description,
        archivedAt: messageVariables.archivedAt,
        createdAt: messageVariables.createdAt,
        updatedAt: messageVariables.updatedAt,
      })
      .from(messageVariables)
      .where(
        and(
          this.inWorkspace(messageVariables),
          archived ? isNotNull(messageVariables.archivedAt) : isNull(messageVariables.archivedAt),
        ),
      )
      .orderBy(desc(messageVariables.updatedAt));
    return rows.map((row) => messageVariableSchema.parse(row));
  }

  /** Inserts a variable; unique-key violations bubble up to the caller. */
  public async createMessageVariable(input: {
    key: string;
    name: string;
    value: string;
    description: string;
  }): Promise<{ id: string }> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(messageVariables).values({
      id,
      workspaceId: this.context.workspaceId,
      key: input.key,
      name: input.name,
      value: input.value,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  /** Updates a live variable; unique-key violations bubble up to the caller. */
  public async updateMessageVariable(
    id: string,
    input: { key: string; name: string; value: string; description: string },
  ): Promise<boolean> {
    const result = await this.database.orm
      .update(messageVariables)
      .set({
        key: input.key,
        name: input.name,
        value: input.value,
        description: input.description,
        updatedAt: nowIso(),
      })
      .where(
        and(
          this.inWorkspace(messageVariables),
          eq(messageVariables.id, id),
          isNull(messageVariables.archivedAt),
        ),
      );
    return changedExactlyOne(result);
  }

  public async archiveMessageVariable(id: string): Promise<boolean> {
    const now = nowIso();
    const result = await this.database.orm
      .update(messageVariables)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          this.inWorkspace(messageVariables),
          eq(messageVariables.id, id),
          isNull(messageVariables.archivedAt),
        ),
      );
    return changedExactlyOne(result);
  }
}
