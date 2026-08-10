import { Archive, Check, Pencil, RotateCcw, Send, Undo2, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { ProjectBriefDetail } from "@openengage/core/projects";

import { BriefStatus } from "./project-brief-detail-components";

export function ProjectBriefDetailHeader({
  detail,
  busy,
  onEdit,
  onSubmit,
  onReview,
  onWithdraw,
  onReopen,
  onComplete,
  onArchive,
}: {
  detail: ProjectBriefDetail;
  busy: boolean;
  onEdit: () => void;
  onSubmit: () => void;
  onReview: (kind: "approve" | "reject") => void;
  onWithdraw: () => void;
  onReopen: () => void;
  onComplete: () => void;
  onArchive: () => void;
}): ReactNode {
  const actions = detail.allowedActions;
  return (
    <div className="flex flex-wrap gap-2">
      <BriefStatus status={detail.project.status} />
      {actions.edit ? (
        <Button variant="outline" disabled={busy} onClick={onEdit}>
          <Pencil data-icon="inline-start" />
          編集
        </Button>
      ) : null}
      {actions.submit ? (
        <Button disabled={busy} onClick={onSubmit}>
          <Send data-icon="inline-start" />
          承認依頼
        </Button>
      ) : null}
      {actions.approve ? (
        <Button disabled={busy} onClick={() => onReview("approve")}>
          <Check data-icon="inline-start" />
          承認
        </Button>
      ) : null}
      {actions.reject ? (
        <Button variant="destructive" disabled={busy} onClick={() => onReview("reject")}>
          <X data-icon="inline-start" />
          差戻し
        </Button>
      ) : null}
      {actions.withdraw ? (
        <Button variant="outline" disabled={busy} onClick={onWithdraw}>
          <Undo2 data-icon="inline-start" />
          申請取消
        </Button>
      ) : null}
      {actions.reopen ? (
        <Button variant="outline" disabled={busy} onClick={onReopen}>
          <RotateCcw data-icon="inline-start" />
          再オープン
        </Button>
      ) : null}
      {actions.complete ? (
        <Button variant="outline" disabled={busy} onClick={onComplete}>
          終了
        </Button>
      ) : null}
      {actions.archive ? (
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label="アーカイブ"
          onClick={onArchive}
        >
          <Archive />
        </Button>
      ) : null}
    </div>
  );
}
