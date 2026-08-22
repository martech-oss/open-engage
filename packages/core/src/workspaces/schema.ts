import * as z from "zod";

import { hasWorkspaceRole, type WorkspaceRole, workspaceRoleSchema } from "../shared/schema";

export const workspaceCapabilitiesSchema = z.object({
  viewReports: z.boolean(),
  manageMarketing: z.boolean(),
  manageWorkspace: z.boolean(),
  manageApiKeys: z.boolean(),
});
export type WorkspaceCapabilities = z.infer<typeof workspaceCapabilitiesSchema>;

export function capabilitiesForRole(role: WorkspaceRole): WorkspaceCapabilities {
  return {
    viewReports: hasWorkspaceRole(role, "analyst"),
    manageMarketing: hasWorkspaceRole(role, "marketer"),
    manageWorkspace: hasWorkspaceRole(role, "admin"),
    manageApiKeys: hasWorkspaceRole(role, "admin"),
  };
}

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  timezone: z.string(),
  created_at: z.number(),
  role: workspaceRoleSchema,
  capabilities: workspaceCapabilitiesSchema,
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const webhookEndpointRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  eventTypes: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WebhookEndpointRow = z.infer<typeof webhookEndpointRowSchema>;
