import type { WorkspaceCapabilities } from "@openengage/core/workspaces";

export function assetPermissions(capabilities: WorkspaceCapabilities): {
  canWrite: boolean;
  canDelete: boolean;
} {
  return {
    canWrite: capabilities.manageMarketing,
    canDelete: capabilities.manageWorkspace,
  };
}
