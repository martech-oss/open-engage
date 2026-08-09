import { and, eq, inArray } from "drizzle-orm";

import {
  automationDefinitionSchema,
  type ApplyEmailSequenceResult,
  type EmailSequenceProposal,
} from "@openengage/core/automations";
import { emailDocumentV2Schema } from "@openengage/core/messaging";

import { emailTemplates } from "../messaging/schema";
import { nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { automations, automationVersions } from "./schema";

const graphCodec = defineJsonCodec(automationDefinitionSchema, "automation_versions.graph");
const contentCodec = defineJsonCodec(emailDocumentV2Schema, "email_templates.draft_content");

export class EmailSequenceDraftConflictError extends Error {
  public override readonly name = "EmailSequenceDraftConflictError";

  public constructor() {
    super("Email sequence draft ids are already used by different resources");
  }
}

export class EmailSequenceDraftRepository extends WorkspaceRepository {
  public async apply(proposal: EmailSequenceProposal): Promise<ApplyEmailSequenceResult> {
    const existing = await this.readExisting(proposal);
    if (existing) return existing;

    const draftVersionId = uuidv7();
    const now = nowIso();
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(emailTemplates).values(
        proposal.emails.map((email) => ({
          id: email.templateId,
          workspaceId,
          name: email.name,
          purpose: email.purpose,
          draftSubject: email.selectedSubject,
          draftContent: contentCodec.encode(email.content),
          createdAt: now,
          updatedAt: now,
        })),
      ),
      orm.insert(automations).values({
        id: proposal.automationId,
        workspaceId,
        name: proposal.definition.name,
        description: proposal.definition.description,
        status: "draft",
        draftVersionId,
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(automationVersions).values({
        id: draftVersionId,
        workspaceId,
        automationId: proposal.automationId,
        version: 1,
        status: "draft",
        timezone: proposal.definition.timezone,
        graph: graphCodec.encode(proposal.definition),
        createdAt: now,
      }),
    ]);
    return resultFor(proposal, draftVersionId);
  }

  private async readExisting(
    proposal: EmailSequenceProposal,
  ): Promise<ApplyEmailSequenceResult | null> {
    const workspaceId = this.context.workspaceId;
    const existingAutomation = await this.database.orm
      .select({ draftVersionId: automations.draftVersionId, graph: automationVersions.graph })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.workspaceId, automations.workspaceId),
          eq(automationVersions.id, automations.draftVersionId),
        ),
      )
      .where(
        and(eq(automations.workspaceId, workspaceId), eq(automations.id, proposal.automationId)),
      )
      .get();
    const ids = proposal.emails.map((email) => email.templateId);
    const existingTemplates = await this.database.orm
      .select({
        id: emailTemplates.id,
        name: emailTemplates.name,
        purpose: emailTemplates.purpose,
        subject: emailTemplates.draftSubject,
        content: emailTemplates.draftContent,
      })
      .from(emailTemplates)
      .where(and(eq(emailTemplates.workspaceId, workspaceId), inArray(emailTemplates.id, ids)));

    if (!existingAutomation && existingTemplates.length === 0) return null;
    if (!existingAutomation || existingTemplates.length !== proposal.emails.length) {
      throw new EmailSequenceDraftConflictError();
    }
    const templateById = new Map(existingTemplates.map((template) => [template.id, template]));
    const templatesMatch = proposal.emails.every((email) => {
      const stored = templateById.get(email.templateId);
      return (
        stored?.name === email.name &&
        stored.purpose === email.purpose &&
        stored.subject === email.selectedSubject &&
        JSON.stringify(contentCodec.decode(stored.content)) === JSON.stringify(email.content)
      );
    });
    const graphMatches =
      JSON.stringify(graphCodec.decode(existingAutomation.graph)) ===
      JSON.stringify(proposal.definition);
    if (!templatesMatch || !graphMatches || !existingAutomation.draftVersionId) {
      throw new EmailSequenceDraftConflictError();
    }
    return resultFor(proposal, existingAutomation.draftVersionId);
  }
}

function resultFor(
  proposal: EmailSequenceProposal,
  draftVersionId: string,
): ApplyEmailSequenceResult {
  return {
    automationId: proposal.automationId,
    draftVersionId,
    templates: proposal.emails.map(({ emailRef, templateId }) => ({ emailRef, templateId })),
    capabilityState: proposal.capabilityState,
  };
}
