import type { WorkspaceRole } from "@openengage/core/shared";

const WRITE_ROLES = new Set<WorkspaceRole>(["marketer", "admin", "owner"]);
const DELETE_ROLES = new Set<WorkspaceRole>(["admin", "owner"]);

export function assetPermissions(role: WorkspaceRole): { canWrite: boolean; canDelete: boolean } {
  return { canWrite: WRITE_ROLES.has(role), canDelete: DELETE_ROLES.has(role) };
}
