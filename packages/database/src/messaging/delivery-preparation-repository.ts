import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { emailDocumentV2Schema, type EmailDocumentV2 } from "@openengage/core/messaging";

import { organization } from "../auth/schema";
import { defineJsonCodec } from "../shared/json-codec";
import { DatabaseRepository } from "../shared/repository-base";
import { webhookEndpoints } from "../workspaces/schema";
import { emailTemplates, messageVariables } from "./schema";

const publishedContentCodec = defineJsonCodec(
  emailDocumentV2Schema,
  "email_templates.published_content",
);

/** Read-only data preparation for queued email and webhook delivery. */
export class MessagingDeliveryPreparationRepository extends DatabaseRepository {
  /** Loads a live template for sending; archived templates are invisible. */
  public async findSendableTemplate(
    workspaceId: string,
    templateId: string,
  ): Promise<{
    id: string;
    purpose: "transactional";
    subject: string;
    content: EmailDocumentV2;
  } | null> {
    const row = await this.database.orm
      .select({
        id: emailTemplates.id,
        purpose: emailTemplates.purpose,
        subject: emailTemplates.publishedSubject,
        content: emailTemplates.publishedContent,
      })
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.workspaceId, workspaceId),
          eq(emailTemplates.id, templateId),
          isNull(emailTemplates.archivedAt),
          eq(emailTemplates.purpose, "transactional"),
          isNotNull(emailTemplates.publishedRevision),
        ),
      )
      .get();
    if (!row?.subject || !row.content) return null;
    return {
      id: row.id,
      purpose: "transactional",
      subject: row.subject,
      content: publishedContentCodec.decode(row.content),
    };
  }

  /** Live message variables as a key → value map, for template resolution. */
  public async readMessageVariables(workspaceId: string): Promise<Record<string, string>> {
    const rows = await this.database.orm
      .select({ key: messageVariables.key, value: messageVariables.value })
      .from(messageVariables)
      .where(
        and(eq(messageVariables.workspaceId, workspaceId), isNull(messageVariables.archivedAt)),
      )
      .orderBy(asc(messageVariables.key));
    return Object.fromEntries(rows.map((variable) => [variable.key, variable.value]));
  }

  public async readWorkspaceTemplateContext(
    workspaceId: string,
  ): Promise<{ id: string; name: string }> {
    const row = await this.database.orm
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.id, workspaceId))
      .get();
    return row ?? { id: workspaceId, name: "" };
  }

  public async findEnabledWebhookEndpoint(
    workspaceId: string,
    endpointId: string,
  ): Promise<{ url: string } | null> {
    const row = await this.database.orm
      .select({ url: webhookEndpoints.url })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.workspaceId, workspaceId),
          eq(webhookEndpoints.id, endpointId),
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .get();
    return row ?? null;
  }

  public async findEnabledWebhookEndpointWithSecret(
    workspaceId: string,
    endpointId: string,
  ): Promise<{ url: string; encryptedSecret: string } | null> {
    const row = await this.database.orm
      .select({ url: webhookEndpoints.url, encryptedSecret: webhookEndpoints.encryptedSecret })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.workspaceId, workspaceId),
          eq(webhookEndpoints.id, endpointId),
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .get();
    return row ?? null;
  }
}
