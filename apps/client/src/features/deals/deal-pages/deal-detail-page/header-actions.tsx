import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, CircleX, Pencil, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Button } from "@/components/ui/button";

import type { DealDetailData, DealStatus } from "../../deal-api";

export function DealHeaderActions({
  deal,
  busyAction,
  onEdit,
  onStatusChange,
}: {
  deal: DealDetailData["deal"];
  busyAction: string | null;
  onEdit: () => void;
  onStatusChange: (status: DealStatus) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" nativeButton={false} render={<Link to="/deals" />}>
        <ArrowLeft data-icon="inline-start" />
        一覧
      </Button>
      <Button variant="outline" onClick={onEdit}>
        <Pencil data-icon="inline-start" />
        編集
      </Button>
      {deal.status === "open" ? (
        <>
          <LoadingButton
            busy={busyAction === "won"}
            variant="outline"
            onClick={() => onStatusChange("won")}
          >
            <Check data-icon="inline-start" />
            獲得
          </LoadingButton>
          <LoadingButton
            busy={busyAction === "lost"}
            variant="outline"
            onClick={() => onStatusChange("lost")}
          >
            <CircleX data-icon="inline-start" />
            失注
          </LoadingButton>
        </>
      ) : (
        <LoadingButton
          busy={busyAction === "open"}
          variant="outline"
          onClick={() => onStatusChange("open")}
        >
          <RotateCcw data-icon="inline-start" />
          再開
        </LoadingButton>
      )}
    </div>
  );
}
