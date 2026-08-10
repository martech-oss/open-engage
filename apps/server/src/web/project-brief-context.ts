import type { ApprovedMarketingBriefContext } from "@openengage/core/projects";

import { approvedProjectBriefContext, ProjectBriefServiceError } from "./project-brief-service";

export interface BriefContextErrors {
  BRIEF_NOT_FOUND: () => Error;
  BRIEF_NOT_APPROVED: () => Error;
  BRIEF_REVISION_CONFLICT: () => Error;
  FORBIDDEN: () => Error;
}

export async function resolveApprovedProjectBriefContext(
  database: Parameters<typeof approvedProjectBriefContext>[0],
  workspace: Parameters<typeof approvedProjectBriefContext>[1],
  reference: { projectId?: string | undefined; briefRevision?: number | undefined },
  errors: BriefContextErrors,
): Promise<ApprovedMarketingBriefContext | undefined> {
  try {
    return await approvedProjectBriefContext(database, workspace, reference);
  } catch (error) {
    if (!(error instanceof ProjectBriefServiceError)) throw error;
    switch (error.kind) {
      case "not_found":
        throw errors.BRIEF_NOT_FOUND();
      case "revision_conflict":
      case "write_conflict":
        throw errors.BRIEF_REVISION_CONFLICT();
      case "forbidden_actor":
        throw errors.FORBIDDEN();
      case "invalid_state":
        throw errors.BRIEF_NOT_APPROVED();
      case "invalid_member":
      case "resource_not_found":
        throw error;
      default:
        return assertNever(error.kind);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled project brief context failure: ${String(value)}`);
}
