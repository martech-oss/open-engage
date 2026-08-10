import { validateAutomation } from "@openengage/core/automations";
import type { AutomationDefinition } from "@openengage/core/automations";
import { AutomationRepository, uuidv7, writeAuditLog } from "@openengage/database";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import {
  approvedProjectBriefContext,
  ProjectBriefServiceError,
} from "../web/project-brief-service";
import { getAutomationAnalytics } from "./analytics-service";
import {
  applyEmailSequence,
  EmailSequenceError,
  generateEmailSequence,
} from "./email-sequence-service";
import { enrollContactManually } from "./enrollment";
import { AutomationGenerationError, generateAutomation } from "./generation-service";
import { listAutomations, normalizeAutomationStatus } from "./list-service";
import { getAutomationPublishability } from "./publishability-service";
import { loadAutomationResourceContext, validateAutomationResources } from "./resource-validation";
import { automationTrigger } from "./triggers";

interface BriefContextErrors {
  BRIEF_NOT_FOUND: () => Error;
  BRIEF_NOT_APPROVED: () => Error;
  BRIEF_REVISION_CONFLICT: () => Error;
  FORBIDDEN: () => Error;
}

export const listAutomationsProcedure = authed.automations.list.handler(async ({ context }) => {
  return listAutomations(context.database, context.workspace.workspaceId);
});

export const createAutomationProcedure = authed.automations.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const trustedBrief = await resolveBriefContext(
      context.database,
      context.workspace,
      input,
      errors,
    );
    const { projectId: _projectId, briefRevision: _briefRevision, ...definition } = input;
    const repository = new AutomationRepository(context.database, context.workspace);
    const created = await repository.createAutomation({
      name: definition.name,
      description: definition.description,
      timezone: definition.timezone,
      graph: definition,
      ...(trustedBrief
        ? {
            projectLink: {
              projectId: trustedBrief.projectId,
              briefRevision: trustedBrief.revision,
              addedByUserId: context.workspace.userId,
            },
          }
        : {}),
    });
    if (trustedBrief) {
      context.executionContext.waitUntil(
        writeAuditLog(context.database, context.workspace, {
          action: "project.item.add",
          resourceType: "project",
          resourceId: trustedBrief.projectId,
          metadata: {
            resourceType: "automation",
            resourceId: created.id,
            briefRevision: trustedBrief.revision,
          },
        }),
      );
    }
    return { id: created.id, draftVersionId: created.draftVersionId };
  },
);

export const generateAutomationProcedure = authed.automations.generate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      const trustedBrief = await resolveBriefContext(
        context.database,
        context.workspace,
        input,
        errors,
      );
      return await generateAutomation(
        context.database,
        context.workspace,
        context.env,
        input,
        trustedBrief,
      );
    } catch (error) {
      if (!(error instanceof AutomationGenerationError)) throw error;
      switch (error.kind) {
        case "failed":
          throw errors.AI_GENERATION_FAILED();
        case "timeout":
          throw errors.AI_GENERATION_TIMEOUT();
        case "unavailable":
          throw errors.AI_GENERATION_UNAVAILABLE();
      }
    }
  },
);

export const generateEmailSequenceProcedure = authed.automations.generateSequence.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      const trustedBrief = await resolveBriefContext(
        context.database,
        context.workspace,
        input,
        errors,
      );
      return await generateEmailSequence(
        context.database,
        context.workspace,
        context.env,
        input,
        trustedBrief,
      );
    } catch (error) {
      if (!(error instanceof EmailSequenceError)) throw error;
      switch (error.kind) {
        case "failed":
        case "conflict":
          throw errors.AI_GENERATION_FAILED();
        case "timeout":
          throw errors.AI_GENERATION_TIMEOUT();
        case "unavailable":
          throw errors.AI_GENERATION_UNAVAILABLE();
      }
    }
  },
);

export const applyEmailSequenceProcedure = authed.automations.applySequence.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      const trustedBrief = await resolveBriefContext(
        context.database,
        context.workspace,
        input,
        errors,
      );
      const { projectId: _projectId, briefRevision: _briefRevision, ...proposal } = input;
      const result = await applyEmailSequence(
        context.database,
        context.workspace,
        proposal,
        trustedBrief
          ? {
              projectId: trustedBrief.projectId,
              briefRevision: trustedBrief.revision,
              addedByUserId: context.workspace.userId,
            }
          : undefined,
      );
      context.executionContext.waitUntil(
        writeAuditLog(context.database, context.workspace, {
          action: "email_sequence.create",
          resourceType: "automation",
          resourceId: result.automationId,
        }),
      );
      if (trustedBrief) {
        context.executionContext.waitUntil(
          writeAuditLog(context.database, context.workspace, {
            action: "project.item.add",
            resourceType: "project",
            resourceId: trustedBrief.projectId,
            metadata: {
              resourceTypes: ["automation", "email"],
              automationId: result.automationId,
              templateIds: result.templates.map((template) => template.templateId),
              briefRevision: trustedBrief.revision,
            },
          }),
        );
      }
      return result;
    } catch (error) {
      if (!(error instanceof EmailSequenceError)) throw error;
      if (error.kind === "conflict") throw errors.SEQUENCE_CONFLICT();
      throw errors.INVALID_SEQUENCE();
    }
  },
);

async function resolveBriefContext(
  database: Parameters<typeof approvedProjectBriefContext>[0],
  workspace: Parameters<typeof approvedProjectBriefContext>[1],
  reference: { projectId?: string | undefined; briefRevision?: number | undefined },
  errors: BriefContextErrors,
) {
  try {
    return await approvedProjectBriefContext(database, workspace, reference);
  } catch (error) {
    if (!(error instanceof ProjectBriefServiceError)) throw error;
    if (error.kind === "not_found") throw errors.BRIEF_NOT_FOUND();
    if (error.kind === "revision_conflict") throw errors.BRIEF_REVISION_CONFLICT();
    if (error.kind === "forbidden_actor") throw errors.FORBIDDEN();
    throw errors.BRIEF_NOT_APPROVED();
  }
}

export const getAutomationDraftProcedure = authed.automations.getDraft.handler(
  async ({ context, input, errors }) => {
    const repository = new AutomationRepository(context.database, context.workspace);
    const row = await repository.getDraft(input.id);
    if (!row) throw errors.AUTOMATION_NOT_FOUND();
    return {
      graph: row.graph,
      status: normalizeAutomationStatus(row.status),
      publishability: await getAutomationPublishability(
        context.database,
        context.workspace,
        row.graph,
      ),
    };
  },
);

export const saveAutomationDraftProcedure = authed.automations.saveDraft.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...definition } = input;
    const repository = new AutomationRepository(context.database, context.workspace);
    const updated = await repository.saveDraft(id, {
      name: definition.name,
      description: definition.description,
      timezone: definition.timezone,
      graph: definition,
    });
    if (!updated) throw errors.DRAFT_NOT_EDITABLE();
    return ack;
  },
);

export const publishAutomationProcedure = authed.automations.publish.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new AutomationRepository(context.database, context.workspace);
    const row = await repository.findPublishableDraft(input.id);
    if (!row) throw errors.DRAFT_NOT_FOUND();

    const definition: AutomationDefinition = row.graph;
    const validation = validateAutomation(definition);
    if (validation.length > 0) {
      throw errors.INVALID_GRAPH({ data: { issues: validation } });
    }

    const resources = await loadAutomationResourceContext(context.database, context.workspace);
    const resourceIssues = validateAutomationResources(definition, resources);
    if (resourceIssues.length > 0) {
      throw errors.INVALID_GRAPH({
        message: "利用できないワークスペースリソースを参照しているノードがあります",
        data: { issues: resourceIssues },
      });
    }

    const source = definition.nodes.find((node) => node.type === "source");
    if (!source) throw errors.INVALID_GRAPH({ message: "開始条件がありません" });
    const trigger = automationTrigger(source.config);
    const published = await repository.publishDraft({
      automationId: input.id,
      draftVersionId: row.draftVersionId,
      currentVersion: row.version,
      timezone: definition.timezone,
      graph: row.graph,
      trigger: {
        sourceNodeId: source.id,
        source: source.config.source,
        eventType: trigger.eventType,
        resourceId: trigger.resourceId,
        reentry: source.config.reentry,
        inactivityDays: trigger.inactivityDays,
      },
    });
    return { publishedVersionId: row.draftVersionId, draftVersionId: published.draftVersionId };
  },
);

export const setAutomationStatusProcedure = authed.automations.setStatus.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new AutomationRepository(context.database, context.workspace);
    const changed = await repository.setAutomationStatus(input.id, input.status);
    if (!changed) throw errors.NOT_CHANGEABLE();
    return { status: input.status };
  },
);

export const enrollAutomationProcedure = authed.automations.enroll.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await enrollContactManually(context.database, {
      workspaceId: context.workspace.workspaceId,
      automationId: input.id,
      contactId: input.contactId,
      sourceEventId: input.sourceEventId ?? uuidv7(),
    });
    switch (outcome.kind) {
      case "not_active":
        throw errors.AUTOMATION_NOT_ACTIVE();
      case "source_missing":
        throw errors.SOURCE_MISSING();
      case "already_enrolled":
        throw errors.ALREADY_ENROLLED();
      case "enrolled":
        return outcome.result;
    }
  },
);

export const automationAnalyticsProcedure = authed.automations.analytics.handler(
  async ({ context, input }) =>
    getAutomationAnalytics(context.database, context.workspace.workspaceId, input.id),
);

export const automationProcedures = {
  list: listAutomationsProcedure,
  create: createAutomationProcedure,
  generate: generateAutomationProcedure,
  generateSequence: generateEmailSequenceProcedure,
  applySequence: applyEmailSequenceProcedure,
  getDraft: getAutomationDraftProcedure,
  saveDraft: saveAutomationDraftProcedure,
  publish: publishAutomationProcedure,
  setStatus: setAutomationStatusProcedure,
  enroll: enrollAutomationProcedure,
  analytics: automationAnalyticsProcedure,
};
