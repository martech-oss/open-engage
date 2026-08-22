import type { WorkspaceCapabilities } from "@openengage/core/workspaces";

export function settingsPermissions(capabilities: WorkspaceCapabilities): {
  canEditWorkspace: boolean;
  canManageApiKeys: boolean;
} {
  return {
    canEditWorkspace: capabilities.manageWorkspace,
    canManageApiKeys: capabilities.manageApiKeys,
  };
}
