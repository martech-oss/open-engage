import { and, eq, exists, inArray, isNull, ne, or, sql } from "drizzle-orm";

import {
  automationDefinitionSchema,
  type ApplyEmailSequenceResult,
  type EmailSequenceProposal,
} from "@openengage/core/automations";
import { emailDocumentV2Schema } from "@openengage/core/messaging";

import { emailTemplates } from "../messaging/schema";
import { conditionalAudit, uniqueOperationIso } from "../projects/project-brief-persistence";
import {
  authenticatedProjectActorId,
  approvedProjectLinkPrecondition,
  ProjectBriefLinkConflictError,
  type ApprovedProjectLink,
} from "../projects/project-resource-guard";
import { projectBriefs, projectItems } from "../projects/schema";
import { isConstraintError, nowIso } from "../shared/database-utils";
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

export interface EmailSequenceDraftApplyOutcome {
  result: ApplyEmailSequenceResult;
  created: boolean;
  linksAdded: number;
}

export class EmailSequenceDraftRepository extends WorkspaceRepository {
  public async apply(
    proposal: EmailSequenceProposal,
    projectLink?: ApprovedProjectLink,
  ): Promise<ApplyEmailSequenceResult> {
    return (await this.applyWithOutcome(proposal, projectLink)).result;
  }

  public async applyWithOutcome(
    proposal: EmailSequenceProposal,
    projectLink?: ApprovedProjectLink,
  ): Promise<EmailSequenceDraftApplyOutcome> {
    const existing = await this.readExisting(proposal);
    if (existing) {
      const linksAdded = projectLink ? await this.ensureExistingLinks(proposal, projectLink) : 0;
      return { result: existing, created: false, linksAdded };
    }

    const draftVersionId = uuidv7();
    const now = nowIso();
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const templateValues = proposal.emails.map((email) => ({
      id: email.templateId,
      workspaceId,
      name: email.name,
      purpose: email.purpose,
      draftSubject: email.selectedSubject,
      draftContent: contentCodec.encode(email.content),
      createdAt: now,
      updatedAt: now,
    }));
    const automationValues = {
      id: proposal.automationId,
      workspaceId,
      name: proposal.definition.name,
      description: proposal.definition.description,
      status: "draft",
      draftVersionId,
      variableProjectId: proposal.definition.variableProjectId ?? null,
      createdAt: now,
      updatedAt: now,
    } as const;
    const versionValues = {
      id: draftVersionId,
      workspaceId,
      automationId: proposal.automationId,
      version: 1,
      status: "draft",
      timezone: proposal.definition.timezone,
      graph: graphCodec.encode(proposal.definition),
      createdAt: now,
    } as const;
    try {
      if (projectLink) {
        await this.createGuarded(
          proposal,
          projectLink,
          draftVersionId,
          now,
          templateValues,
          versionValues.graph,
        );
      } else {
        await orm.batch([
          orm.insert(emailTemplates).values(templateValues),
          orm.insert(automations).values(automationValues),
          orm.insert(automationVersions).values(versionValues),
        ]);
      }
    } catch (cause) {
      if (!isConstraintError(cause)) throw cause;

      // Two first applies can both observe an empty bundle before one of the
      // transactional batches wins the unique-key race.  Only converge when
      // the committed winner is a complete, byte-for-byte equivalent draft;
      // unrelated constraints and mismatched resources still fail.
      const concurrent = await this.readExisting(proposal);
      if (!concurrent) throw cause;
      const linksAdded = projectLink ? await this.ensureExistingLinks(proposal, projectLink) : 0;
      return { result: concurrent, created: false, linksAdded };
    }
    return {
      result: resultFor(proposal, draftVersionId),
      created: true,
      linksAdded: projectLink ? sequenceResources(proposal).length : 0,
    };
  }

  private async createGuarded(
    proposal: EmailSequenceProposal,
    link: ApprovedProjectLink,
    draftVersionId: string,
    now: string,
    templates: Array<typeof emailTemplates.$inferInsert>,
    encodedGraph: string,
  ): Promise<void> {
    const orm = this.database.orm;
    const workspaceId = this.context.workspaceId;
    const precondition = approvedProjectLinkPrecondition(
      orm,
      workspaceId,
      authenticatedProjectActorId(this.context),
      link,
    );
    const templateRowsJson = JSON.stringify(
      templates.map((template) => ({
        id: template.id,
        name: template.name,
        purpose: template.purpose,
        draftSubject: template.draftSubject,
        draftContent: template.draftContent,
      })),
    );
    const templateRows = sql`SELECT
      json_extract(template_row.value, '$.id'),
      ${workspaceId},
      json_extract(template_row.value, '$.name'),
      json_extract(template_row.value, '$.purpose'),
      json_extract(template_row.value, '$.draftSubject'),
      json_extract(template_row.value, '$.draftContent'),
      1, NULL, NULL, NULL, NULL, NULL, ${now}, ${now}
    FROM json_each(${templateRowsJson}) AS template_row
    WHERE ${exists(precondition)}`;
    const resources = sequenceResources(proposal);
    const resourceRowsJson = JSON.stringify(resources);
    const itemRows = sql`SELECT
      ${workspaceId},
      ${link.projectId},
      json_extract(resource_row.value, '$.resourceType'),
      json_extract(resource_row.value, '$.resourceId'),
      ${link.briefRevision}, ${link.addedByUserId}, ${now}
    FROM json_each(${resourceRowsJson}) AS resource_row
    WHERE ${exists(precondition)}`;
    const [created] = await orm.batch([
      orm.insert(emailTemplates).select(templateRows),
      orm.insert(automations).select(
        sql`SELECT
          ${proposal.automationId}, ${workspaceId}, ${proposal.definition.name},
          ${proposal.definition.description}, 'draft', ${draftVersionId}, NULL, ${now}, ${now},
          ${proposal.definition.variableProjectId ?? null}
        WHERE ${exists(precondition)}`,
      ),
      orm.insert(automationVersions).select(
        sql`SELECT
          ${draftVersionId}, ${workspaceId}, ${proposal.automationId}, 1, 'draft',
          ${proposal.definition.timezone}, ${encodedGraph}, NULL, ${now}, NULL, '{}', NULL
        WHERE ${exists(precondition)}`,
      ),
      orm.insert(projectItems).select(itemRows),
      conditionalAudit(
        orm,
        this.context,
        link.addedByUserId,
        {
          action: "email_sequence.create",
          resourceType: "automation",
          resourceId: proposal.automationId,
        },
        precondition,
        now,
      ),
      conditionalAudit(
        orm,
        this.context,
        link.addedByUserId,
        {
          action: "project.item.add",
          resourceType: "project",
          resourceId: link.projectId,
          metadata: {
            resourceTypes: ["automation", "email"],
            automationId: proposal.automationId,
            templateIds: proposal.emails.map((email) => email.templateId),
            briefRevision: link.briefRevision,
          },
        },
        precondition,
        now,
      ),
      orm
        .update(projectBriefs)
        .set({ rowVersion: sql`${projectBriefs.rowVersion} + 1`, updatedAt: now })
        .where(
          and(
            eq(projectBriefs.workspaceId, workspaceId),
            eq(projectBriefs.projectId, link.projectId),
            exists(precondition),
          ),
        ),
    ]);
    if (created.meta.changes !== templates.length) throw new ProjectBriefLinkConflictError();
  }

  private async ensureExistingLinks(
    proposal: EmailSequenceProposal,
    link: ApprovedProjectLink,
  ): Promise<number> {
    const orm = this.database.orm;
    const workspaceId = this.context.workspaceId;
    const precondition = approvedProjectLinkPrecondition(
      orm,
      workspaceId,
      authenticatedProjectActorId(this.context),
      link,
    );
    if (!(await precondition.get())) throw new ProjectBriefLinkConflictError();
    const resources = sequenceResources(proposal);
    const existing = await orm
      .select({
        resourceType: projectItems.resourceType,
        resourceId: projectItems.resourceId,
        briefRevision: projectItems.briefRevision,
      })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.workspaceId, workspaceId),
          eq(projectItems.projectId, link.projectId),
          inArray(
            projectItems.resourceId,
            resources.map((resource) => resource.resourceId),
          ),
        ),
      );
    const linked = new Set(
      existing
        .filter((item) => item.briefRevision === link.briefRevision)
        .map((item) => `${item.resourceType}:${item.resourceId}`),
    );
    const missing = resources.filter(
      (resource) => !linked.has(`${resource.resourceType}:${resource.resourceId}`),
    );
    if (missing.length === 0) return 0;

    const now = uniqueOperationIso();
    const missingRowsJson = JSON.stringify(missing);
    const itemRows = sql`SELECT
      ${workspaceId},
      ${link.projectId},
      json_extract(resource_row.value, '$.resourceType'),
      json_extract(resource_row.value, '$.resourceId'),
      ${link.briefRevision}, ${link.addedByUserId}, ${now}
    FROM json_each(${missingRowsJson}) AS resource_row
    WHERE ${exists(precondition)}`;
    const marker = orm
      .select({ id: projectItems.resourceId })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.workspaceId, workspaceId),
          eq(projectItems.projectId, link.projectId),
          eq(projectItems.addedByUserId, link.addedByUserId),
          eq(projectItems.createdAt, now),
          inArray(
            projectItems.resourceId,
            missing.map((resource) => resource.resourceId),
          ),
        ),
      );
    const missingResource = or(
      ...missing.map((resource) =>
        and(
          eq(projectItems.resourceType, resource.resourceType),
          eq(projectItems.resourceId, resource.resourceId),
        ),
      ),
    );
    const [updated, inserted] = await orm.batch([
      orm
        .update(projectItems)
        .set({
          briefRevision: link.briefRevision,
          addedByUserId: link.addedByUserId,
          createdAt: now,
        })
        .where(
          and(
            eq(projectItems.workspaceId, workspaceId),
            eq(projectItems.projectId, link.projectId),
            or(
              isNull(projectItems.briefRevision),
              ne(projectItems.briefRevision, link.briefRevision),
            ),
            missingResource,
            exists(precondition),
          ),
        ),
      orm.insert(projectItems).select(itemRows).onConflictDoNothing(),
      conditionalAudit(
        orm,
        this.context,
        link.addedByUserId,
        {
          action: "project.item.add",
          resourceType: "project",
          resourceId: link.projectId,
          metadata: {
            resourceTypes: ["automation", "email"],
            requestedLinks: missing,
            briefRevision: link.briefRevision,
          },
        },
        orm
          .select({ id: projectBriefs.projectId })
          .from(projectBriefs)
          .where(and(exists(precondition), exists(marker))),
        now,
      ),
      orm
        .update(projectBriefs)
        .set({ rowVersion: sql`${projectBriefs.rowVersion} + 1`, updatedAt: now })
        .where(
          and(
            eq(projectBriefs.workspaceId, workspaceId),
            eq(projectBriefs.projectId, link.projectId),
            exists(precondition),
            exists(marker),
          ),
        ),
    ]);
    const linksAdded = updated.meta.changes + inserted.meta.changes;
    if (linksAdded === 0 && !(await precondition.get())) {
      throw new ProjectBriefLinkConflictError();
    }
    return linksAdded;
  }

  private async readExisting(
    proposal: EmailSequenceProposal,
  ): Promise<ApplyEmailSequenceResult | null> {
    const workspaceId = this.context.workspaceId;
    const existingAutomation = await this.database.orm
      .select({
        draftVersionId: automations.draftVersionId,
        name: automations.name,
        description: automations.description,
        status: automations.status,
        versionStatus: automationVersions.status,
        graph: automationVersions.graph,
      })
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
        draftRevision: emailTemplates.draftRevision,
        publishedSubject: emailTemplates.publishedSubject,
        publishedContent: emailTemplates.publishedContent,
        publishedRevision: emailTemplates.publishedRevision,
        publishedAt: emailTemplates.publishedAt,
        archivedAt: emailTemplates.archivedAt,
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
        stored.draftRevision === 1 &&
        stored.publishedSubject === null &&
        stored.publishedContent === null &&
        stored.publishedRevision === null &&
        stored.publishedAt === null &&
        stored.archivedAt === null &&
        JSON.stringify(contentCodec.decode(stored.content)) === JSON.stringify(email.content)
      );
    });
    const graphMatches =
      JSON.stringify(graphCodec.decode(existingAutomation.graph)) ===
      graphCodec.encode(proposal.definition);
    if (
      !templatesMatch ||
      !graphMatches ||
      !existingAutomation.draftVersionId ||
      existingAutomation.name !== proposal.definition.name ||
      existingAutomation.description !== proposal.definition.description ||
      existingAutomation.status !== "draft" ||
      existingAutomation.versionStatus !== "draft"
    ) {
      throw new EmailSequenceDraftConflictError();
    }
    return resultFor(proposal, existingAutomation.draftVersionId);
  }
}

function sequenceResources(proposal: EmailSequenceProposal) {
  return [
    { resourceType: "automation" as const, resourceId: proposal.automationId },
    ...proposal.emails.map((email) => ({
      resourceType: "email_sequence" as const,
      resourceId: email.templateId,
    })),
  ];
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
