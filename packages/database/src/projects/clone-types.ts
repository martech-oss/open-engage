import type {
  ProjectCloneOptions,
  ProjectClonePreview,
  ProjectCloneReferenceMap,
  ProjectCloneResource,
} from "@openengage/core/projects";

export interface ProjectCloneSnapshot {
  resource: ProjectCloneResource;
  row: Record<string, unknown>;
}
export interface ProjectCloneCapture {
  sourceProjectId: string;
  targetProjectId: string;
  options: ProjectCloneOptions;
  snapshots: ProjectCloneSnapshot[];
  sharedReferences: ProjectClonePreview["sharedReferences"];
  referenceMap: ProjectCloneReferenceMap;
}

export class ProjectCloneError extends Error {
  public constructor(
    public readonly kind: "not_found" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "ProjectCloneError";
  }
}
