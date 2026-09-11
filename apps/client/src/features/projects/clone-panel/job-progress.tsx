import { Link } from "@tanstack/react-router";

import { ErrorAlert, LoadingButton } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type { ProjectCloneSummary } from "@openengage/core/projects";

import { useCloneJobController } from "./controller";
import { statusLabels } from "./labels";

export function CloneJobProgress({ job, canEdit }: { job: ProjectCloneSummary; canEdit: boolean }) {
  const controller = useCloneJobController(job);
  return (
    <div className="space-y-2 rounded-md border p-3" aria-label={`${job.name}の複製状況`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{job.name}</strong>
        <span>{statusLabels[job.status]}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        準備済み {job.preparedCount} / {job.totalCount} 件
      </p>
      {["running", "queued"].includes(job.status) && (
        <progress
          className="w-full"
          max={job.totalCount || 1}
          value={job.preparedCount}
          aria-label="複製の進捗"
        />
      )}
      {job.error && <ErrorAlert>{job.error}</ErrorAlert>}
      {controller.error && (
        <ErrorAlert>{getErrorMessage(controller.error, "再試行できませんでした")}</ErrorAlert>
      )}
      {job.status === "failed" && canEdit && (
        <LoadingButton busy={controller.pending} variant="outline" onClick={controller.retry}>
          失敗した複製を再試行
        </LoadingButton>
      )}
      {job.status === "completed" && (
        <Button
          variant="outline"
          render={<Link to="/projects/$id" params={{ id: job.targetProjectId }} />}
        >
          複製先を開く
        </Button>
      )}
    </div>
  );
}
