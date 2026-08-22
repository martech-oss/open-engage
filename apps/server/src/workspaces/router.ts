import { authed, requireRole, sessionOnly } from "../orpc/base";
import { createApiKey } from "./api-key-service";
import {
  createWorkspace,
  getEmailBrandProfile,
  getWorkspace,
  updateEmailBrandProfile,
} from "./service";
import { createWebhookEndpoint, listWebhookEndpoints } from "./webhook-endpoint-service";

export const createWorkspaceProcedure = sessionOnly.workspace.create.handler(
  async ({ context, input }) =>
    createWorkspace(context.database, context.env, context.headers, input.name),
);

export const getWorkspaceProcedure = authed.workspace.get.handler(async ({ context }) =>
  getWorkspace(context.database, context.workspace),
);

export const getEmailBrandProcedure = authed.workspace.getEmailBrand.handler(({ context }) =>
  getEmailBrandProfile(context.database, context.workspace),
);

export const updateEmailBrandProcedure = authed.workspace.updateEmailBrand.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const result = await updateEmailBrandProfile(context.database, context.workspace, input);
    if (result.kind === "invalid_logo") throw errors.BRAND_LOGO_INVALID();
    return result.profile;
  },
);

export const listWebhookEndpointsProcedure = authed.workspace.listWebhookEndpoints.handler(
  async ({ context, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    return listWebhookEndpoints(context.database, context.workspace.workspaceId);
  },
);

export const createWebhookEndpointProcedure = authed.workspace.createWebhookEndpoint.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const outcome = await createWebhookEndpoint(
      context.database,
      context.env.CREDENTIAL_ENCRYPTION_KEY,
      context.workspace.workspaceId,
      input,
    );
    if (outcome.kind === "unsafe_url") throw errors.UNSAFE_WEBHOOK_URL();
    return { id: outcome.id, signingSecret: outcome.signingSecret };
  },
);

export const createApiKeyProcedure = authed.workspace.createApiKey.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    return createApiKey(context.database, context.workspace, input);
  },
);

export const workspaceProcedures = {
  create: createWorkspaceProcedure,
  get: getWorkspaceProcedure,
  getEmailBrand: getEmailBrandProcedure,
  updateEmailBrand: updateEmailBrandProcedure,
  createApiKey: createApiKeyProcedure,
  listWebhookEndpoints: listWebhookEndpointsProcedure,
  createWebhookEndpoint: createWebhookEndpointProcedure,
};
