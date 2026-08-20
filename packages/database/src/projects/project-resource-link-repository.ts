import type { WorkspaceContext } from "@openengage/core/shared";

import { WorkspaceRepository } from "../shared/repository-base";
import { ProjectResourceCommandRepository } from "./project-resource-command-repository";
import { ProjectResourceQueryRepository } from "./project-resource-query-repository";

export type { ProjectResourceLinkOutcome } from "./project-resource-link-types";

/** Compatibility facade over project-resource queries and guarded commands. */
export class ProjectResourceLinkRepository extends WorkspaceRepository<WorkspaceContext> {
  private readonly queries = new ProjectResourceQueryRepository(this.database, this.context);
  private readonly commands = new ProjectResourceCommandRepository(this.database, this.context);

  public list(...args: Parameters<ProjectResourceQueryRepository["list"]>) {
    return this.queries.list(...args);
  }
  public isAvailable(...args: Parameters<ProjectResourceQueryRepository["isAvailable"]>) {
    return this.queries.isAvailable(...args);
  }
  public addApproved(...args: Parameters<ProjectResourceCommandRepository["addApproved"]>) {
    return this.commands.addApproved(...args);
  }
  public removeApproved(...args: Parameters<ProjectResourceCommandRepository["removeApproved"]>) {
    return this.commands.removeApproved(...args);
  }
}
