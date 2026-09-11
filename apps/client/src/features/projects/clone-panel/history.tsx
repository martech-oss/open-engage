import { ErrorAlert } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type { ProjectCloneSummary } from "@openengage/core/projects";

import { CloneJobProgress } from "./job-progress";

export function CloneHistory({
  items,
  error,
  fetching,
  hasPrevious,
  hasNext,
  canEdit,
  onPrevious,
  onNext,
}: {
  items: ProjectCloneSummary[] | undefined;
  error: Error | null;
  fetching: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  canEdit: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <>
      {error && <ErrorAlert>{getErrorMessage(error, "複製履歴を取得できませんでした")}</ErrorAlert>}
      {items?.map((job) => (
        <CloneJobProgress key={job.id} job={job} canEdit={canEdit} />
      ))}
      <div className="flex gap-2" aria-label="複製履歴のページ">
        <Button variant="outline" disabled={!hasPrevious || fetching} onClick={onPrevious}>
          前へ
        </Button>
        <Button variant="outline" disabled={!hasNext || fetching} onClick={onNext}>
          次へ
        </Button>
      </div>
    </>
  );
}
