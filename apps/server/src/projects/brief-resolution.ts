import type { WorkspaceContext } from "@openengage/core/shared";
import type { OpenEngageDatabase } from "@openengage/database/client";

import { approvedProjectBriefContext, ProjectBriefServiceError } from "./project-brief-service";

export type CommandBriefResolution =
  | { kind: "ok"; brief: { projectId: string; revision: number } | undefined }
  | { kind: "brief_not_found" }
  | { kind: "brief_not_approved" }
  | { kind: "brief_revision_conflict" }
  | { kind: "forbidden" };

export interface CommandBriefReference {
  projectId?: string | undefined;
  briefRevision?: number | undefined;
}

export async function resolveCommandBrief(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  reference: CommandBriefReference,
): Promise<CommandBriefResolution> {
  try {
    const brief = await approvedProjectBriefContext(database, workspace, reference);
    return {
      kind: "ok",
      brief: brief ? { projectId: brief.projectId, revision: brief.revision } : undefined,
    };
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
