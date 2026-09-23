import type { ApprovedMarketingBriefContext } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";

import { approvedProjectBriefContext, ProjectBriefServiceError } from "./project-brief-service";

/** Why a command or generation cannot use the project brief it references. */
export type BriefResolutionFailure =
  | { kind: "brief_not_found" }
  | { kind: "brief_not_approved" }
  | { kind: "brief_revision_conflict" }
  | { kind: "forbidden" };

export type ApprovedBriefResolution =
  | { kind: "ok"; brief: ApprovedMarketingBriefContext | undefined }
  | BriefResolutionFailure;

export type CommandBriefResolution =
  | { kind: "ok"; brief: { projectId: string; revision: number } | undefined }
  | BriefResolutionFailure;

export interface CommandBriefReference {
  projectId?: string | undefined;
  briefRevision?: number | undefined;
}

/** Resolves an optional brief reference to its approved context; no reference resolves to undefined. */
export async function resolveApprovedBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  reference: CommandBriefReference,
): Promise<ApprovedBriefResolution> {
  try {
    return { kind: "ok", brief: await approvedProjectBriefContext(database, workspace, reference) };
  } catch (error) {
    if (!(error instanceof ProjectBriefServiceError)) throw error;
    switch (error.kind) {
      case "not_found":
        return { kind: "brief_not_found" };
      case "invalid_state":
        return { kind: "brief_not_approved" };
      case "revision_conflict":
      case "write_conflict":
        return { kind: "brief_revision_conflict" };
      case "forbidden_actor":
        return { kind: "forbidden" };
      case "invalid_member":
      case "resource_not_found":
        throw error;
    }
  }
}

export async function resolveCommandBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  reference: CommandBriefReference,
): Promise<CommandBriefResolution> {
  const resolution = await resolveApprovedBrief(database, workspace, reference);
  if (resolution.kind !== "ok") return resolution;
  const { brief } = resolution;
  return {
    kind: "ok",
    brief: brief ? { projectId: brief.projectId, revision: brief.revision } : undefined,
  };
}

export interface BriefFailureErrors {
  BRIEF_NOT_FOUND: () => Error;
  BRIEF_NOT_APPROVED: () => Error;
  BRIEF_REVISION_CONFLICT: () => Error;
  FORBIDDEN: () => Error;
}

/** Throws the contract error every brief-referencing procedure declares for `failure`. */
export function throwBriefFailure(
  errors: BriefFailureErrors,
  failure: BriefResolutionFailure,
): never {
  switch (failure.kind) {
    case "brief_not_found":
      throw errors.BRIEF_NOT_FOUND();
    case "brief_not_approved":
      throw errors.BRIEF_NOT_APPROVED();
    case "brief_revision_conflict":
      throw errors.BRIEF_REVISION_CONFLICT();
    case "forbidden":
      throw errors.FORBIDDEN();
  }
}

/** The approved brief context a generation procedure may pass to its Agent, or the contract error. */
export async function requireApprovedBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  reference: CommandBriefReference,
  errors: BriefFailureErrors,
): Promise<ApprovedMarketingBriefContext | undefined> {
  const resolution = await resolveApprovedBrief(database, workspace, reference);
  if (resolution.kind !== "ok") throwBriefFailure(errors, resolution);
  return resolution.brief;
}
