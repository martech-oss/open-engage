import { EmailTrackingSettingsRepository, MessagingRepository } from "@openengage/database";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { EmailGenerationError, generateEmail } from "./email-generation-service";
import { EmailImageGenerationError, generateEmailImage } from "./email-image-generation-service";
import {
  createEmailTemplate,
  EmailTemplateServiceError,
  previewEmailTemplateDraft,
  publishEmailTemplate,
  updateEmailTemplate,
} from "./email-template-service";
import {
  archiveMessageVariable,
  createMessageVariable,
  listEmailSegmentOptions,
  listMessageVariables,
  listSubscriptionTopicOptions,
  updateMessageVariable,
  VariableConflictError,
} from "./service";

export const listTemplatesProcedure = authed.emails.listTemplates.handler(({ context, input }) =>
  new MessagingRepository(context.database, context.workspace).listEmailTemplates(input.archived),
);

export const generateTemplateProcedure = authed.emails.generateTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await generateEmail(context.database, context.workspace, context.env, input);
    } catch (error) {
      if (!(error instanceof EmailGenerationError)) throw error;
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

export const generateImageProcedure = authed.emails.generateImage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await generateEmailImage(
        context.database,
        context.workspace,
        context.env,
        input,
        context.executionContext,
      );
    } catch (error) {
      if (!(error instanceof EmailImageGenerationError)) throw error;
      switch (error.kind) {
        case "failed":
          throw errors.IMAGE_GENERATION_FAILED();
        case "timeout":
          throw errors.IMAGE_GENERATION_TIMEOUT();
        case "unavailable":
          throw errors.IMAGE_GENERATION_UNAVAILABLE();
      }
    }
  },
);

export const createTemplateProcedure = authed.emails.createTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await createEmailTemplate(context.database, context.workspace, input);
    } catch (error) {
      if (error instanceof EmailTemplateServiceError && error.kind === "invalid_asset") {
        throw errors.EMAIL_ASSET_INVALID();
      }
      throw error;
    }
  },
);

export const updateTemplateProcedure = authed.emails.updateTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    try {
      await updateEmailTemplate(context.database, context.workspace, id, changes);
    } catch (error) {
      if (!(error instanceof EmailTemplateServiceError)) throw error;
      if (error.kind === "not_found") throw errors.TEMPLATE_NOT_FOUND();
      if (error.kind === "invalid_asset") throw errors.EMAIL_ASSET_INVALID();
      throw error;
    }
    return ack;
  },
);

export const previewTemplateProcedure = authed.emails.previewTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await previewEmailTemplateDraft(
        context.database,
        context.workspace,
        context.env.APP_URL,
        input,
      );
    } catch (error) {
      if (error instanceof EmailTemplateServiceError && error.kind === "invalid_asset") {
        throw errors.EMAIL_ASSET_INVALID();
      }
      throw error;
    }
  },
);

export const publishTemplateProcedure = authed.emails.publishTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      await publishEmailTemplate(
        context.database,
        context.workspace,
        context.env.APP_URL,
        input.id,
      );
    } catch (error) {
      if (!(error instanceof EmailTemplateServiceError)) throw error;
      if (error.kind === "not_found") throw errors.TEMPLATE_NOT_FOUND();
      if (error.kind === "invalid_asset") throw errors.EMAIL_ASSET_INVALID();
      if (error.kind === "marketing_brand_incomplete") {
        throw errors.MARKETING_BRAND_INCOMPLETE();
      }
      throw error;
    }
    return ack;
  },
);

export const archiveTemplateProcedure = authed.emails.archiveTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const repository = new MessagingRepository(context.database, context.workspace);
    if (!(await repository.archiveEmailTemplate(input.id))) {
      throw errors.TEMPLATE_NOT_FOUND();
    }
    return ack;
  },
);

export const listVariablesProcedure = authed.emails.listVariables.handler(({ context, input }) =>
  listMessageVariables(context.database, context.workspace, input.archived),
);

export const createVariableProcedure = authed.emails.createVariable.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await createMessageVariable(context.database, context.workspace, input);
    } catch (error) {
      if (error instanceof VariableConflictError) throw errors.VARIABLE_CONFLICT();
      throw error;
    }
  },
);

export const updateVariableProcedure = authed.emails.updateVariable.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    try {
      if (!(await updateMessageVariable(context.database, context.workspace, id, changes))) {
        throw errors.MESSAGE_VARIABLE_NOT_FOUND();
      }
    } catch (error) {
      if (error instanceof VariableConflictError) throw errors.VARIABLE_CONFLICT();
      throw error;
    }
    return ack;
  },
);

export const archiveVariableProcedure = authed.emails.archiveVariable.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    if (!(await archiveMessageVariable(context.database, context.workspace, input.id))) {
      throw errors.MESSAGE_VARIABLE_NOT_FOUND();
    }
    return ack;
  },
);

export const listSegmentOptionsProcedure = authed.emails.listSegmentOptions.handler(({ context }) =>
  listEmailSegmentOptions(context.database, context.workspace),
);

export const listTopicOptionsProcedure = authed.emails.listTopicOptions.handler(({ context }) =>
  listSubscriptionTopicOptions(context.database, context.workspace),
);

export const getTrackingSettingsProcedure = authed.emails.getTrackingSettings.handler(
  ({ context }) =>
    new EmailTrackingSettingsRepository(context.database, context.workspace).getSettings(),
);

export const updateTrackingSettingsProcedure = authed.emails.updateTrackingSettings.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    await new EmailTrackingSettingsRepository(context.database, context.workspace).updateSettings(
      input,
    );
    return ack;
  },
);

export const messagingProcedures = {
  listTemplates: listTemplatesProcedure,
  generateTemplate: generateTemplateProcedure,
  generateImage: generateImageProcedure,
  createTemplate: createTemplateProcedure,
  updateTemplate: updateTemplateProcedure,
  previewTemplate: previewTemplateProcedure,
  publishTemplate: publishTemplateProcedure,
  archiveTemplate: archiveTemplateProcedure,
  listVariables: listVariablesProcedure,
  createVariable: createVariableProcedure,
  updateVariable: updateVariableProcedure,
  archiveVariable: archiveVariableProcedure,
  listSegmentOptions: listSegmentOptionsProcedure,
  listTopicOptions: listTopicOptionsProcedure,
  getTrackingSettings: getTrackingSettingsProcedure,
  updateTrackingSettings: updateTrackingSettingsProcedure,
};
