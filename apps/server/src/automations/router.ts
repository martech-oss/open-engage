import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { resolveApprovedProjectBriefContext } from "../projects/project-brief-context";
import { getAutomationAnalytics } from "./analytics-service";
import { createAutomationCommandService } from "./command-service";
import { EmailSequenceError, generateEmailSequence } from "./email-sequence-service";
import { enrollContactManually } from "./enrollment";
import { AutomationGenerationError, generateAutomation } from "./generation-service";
import { getAutomationDraft, listAutomations } from "./list-service";

export const listAutomationsProcedure = authed.automations.list.handler(async ({ context }) => {
  return listAutomations(context.database, context.workspace.workspaceId);
});

export const createAutomationProcedure = authed.automations.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createAutomationCommandService({
      database: context.database,
      workspace: context.workspace,
      defer: (promise) => context.executionContext.waitUntil(promise),
    }).create(input);
    switch (outcome.kind) {
      case "ok":
        return outcome.automation;
      case "brief_not_found":
        throw errors.BRIEF_NOT_FOUND();
      case "brief_not_approved":
        throw errors.BRIEF_NOT_APPROVED();
      case "brief_revision_conflict":
        throw errors.BRIEF_REVISION_CONFLICT();
      case "forbidden":
        throw errors.FORBIDDEN();
    }
  },
);

export const generateAutomationProcedure = authed.automations.generate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      const trustedBrief = await resolveApprovedProjectBriefContext(
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
      const trustedBrief = await resolveApprovedProjectBriefContext(
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
    const outcome = await createAutomationCommandService({
      database: context.database,
      workspace: context.workspace,
      defer: (promise) => context.executionContext.waitUntil(promise),
    }).applyEmailSequence(input);
    switch (outcome.kind) {
      case "ok":
        return outcome.sequence;
      case "sequence_conflict":
        throw errors.SEQUENCE_CONFLICT();
      case "invalid_sequence":
        throw errors.INVALID_SEQUENCE();
      case "brief_not_found":
        throw errors.BRIEF_NOT_FOUND();
      case "brief_not_approved":
        throw errors.BRIEF_NOT_APPROVED();
      case "brief_revision_conflict":
        throw errors.BRIEF_REVISION_CONFLICT();
      case "forbidden":
        throw errors.FORBIDDEN();
    }
  },
);

export const getAutomationDraftProcedure = authed.automations.getDraft.handler(
  async ({ context, input, errors }) => {
    const draft = await getAutomationDraft(context.database, context.workspace, input.id);
    if (!draft) throw errors.AUTOMATION_NOT_FOUND();
    return draft;
  },
);

export const saveAutomationDraftProcedure = authed.automations.saveDraft.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createAutomationCommandService({
      database: context.database,
      workspace: context.workspace,
      defer: (promise) => context.executionContext.waitUntil(promise),
    }).saveDraft(input);
    if (outcome.kind === "draft_not_editable") throw errors.DRAFT_NOT_EDITABLE();
    return ack;
  },
);

export const publishAutomationProcedure = authed.automations.publish.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createAutomationCommandService({
      database: context.database,
      workspace: context.workspace,
      defer: (promise) => context.executionContext.waitUntil(promise),
    }).publish(input.id);
    switch (outcome.kind) {
      case "ok":
        return outcome.automation;
      case "draft_not_found":
        throw errors.DRAFT_NOT_FOUND();
      case "invalid_graph":
        throw errors.INVALID_GRAPH({
          ...(outcome.message ? { message: outcome.message } : {}),
          data: { issues: outcome.issues },
        });
    }
  },
);

export const setAutomationStatusProcedure = authed.automations.setStatus.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createAutomationCommandService({
      database: context.database,
      workspace: context.workspace,
      defer: (promise) => context.executionContext.waitUntil(promise),
    }).setStatus(input.id, input.status);
    if (outcome.kind === "not_changeable") throw errors.NOT_CHANGEABLE();
    return { status: outcome.status };
  },
);

export const enrollAutomationProcedure = authed.automations.enroll.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await enrollContactManually(context.database, {
      workspaceId: context.workspace.workspaceId,
      automationId: input.id,
      contactId: input.contactId,
      sourceEventId: input.sourceEventId,
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

import { automationExecutionProcedures } from "./execution-router";

export const automationProcedures = {
  ...automationExecutionProcedures,
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
