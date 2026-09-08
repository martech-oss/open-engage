import type { ProjectCloneOptions } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import { createDatabase, type OpenEngageDatabase } from "@openengage/database/client";
import {
  ProjectCloneError,
  ProjectCloneRecoveryRepository,
  ProjectCloneReferenceRepository,
  ProjectCloneRepository,
  ProjectCloneSnapshotRepository,
} from "@openengage/database/projects";

import type { RuntimeEnv } from "../env";
import { logError } from "../observability";

export async function previewProjectClone(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  projectId: string,
  options: ProjectCloneOptions,
  publicOrigin: string,
) {
  const capture = await new ProjectCloneSnapshotRepository(database, workspace).capture(
    projectId,
    options,
    new URL(publicOrigin).origin,
  );
  capture.sharedReferences = await new ProjectCloneReferenceRepository(database, workspace).collect(
    capture,
  );
  return new ProjectCloneRepository(database, workspace).createPreview(capture, workspace.userId);
}

export async function getProjectClone(
  database: OpenEngageDatabase,
  workspaceId: string,
  projectId: string,
  jobId: string,
) {
  const job = await new ProjectCloneRepository(database, { workspaceId }).get(jobId);
  if (!job || job.sourceProjectId !== projectId)
    throw new ProjectCloneError("not_found", "複製ジョブが見つかりません");
  return job;
}

export async function processProjectClone(env: RuntimeEnv, workspaceId: string, jobId: string) {
  const repository = new ProjectCloneRepository(createDatabase(env.DB), { workspaceId });
  try {
    const result = await repository.process(jobId);
    if (result === "continue")
      await env.JOBS_QUEUE.send({ kind: "project_clone", workspaceId, jobId });
    if (result === "completed") {
      const job = await repository.get(jobId);
      for (const segment of job?.resources.filter((resource) => resource.kind === "segment") ??
        []) {
        await env.JOBS_QUEUE.send({
          kind: "segment_full_refresh",
          workspaceId,
          segmentId: segment.targetId,
          filterVersion: 1,
        });
      }
    }
  } catch (error) {
    logError("project.clone_failed", error, { workspaceId, jobId });
    throw error;
  }
}

export async function recoverProjectClones(env: RuntimeEnv) {
  for (const job of await new ProjectCloneRecoveryRepository(createDatabase(env.DB)).due(
    new Date().toISOString(),
  )) {
    await env.JOBS_QUEUE.send({
      kind: "project_clone",
      workspaceId: job.workspaceId,
      jobId: job.id,
    });
  }
}
