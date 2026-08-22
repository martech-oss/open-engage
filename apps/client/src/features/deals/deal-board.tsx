import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  EllipsisVertical,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { EmptyState } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type DealPipeline, type DealSummary } from "@/features/deals/deal-api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { DealStatusBadge } from "./deal-widgets";

export function DealBoard({
  pipeline,
  deals,
  movingId,
  onMove,
  onCreate,
  onAddStage,
  onEditStage,
  onDeleteStage,
}: {
  pipeline: DealPipeline;
  deals: DealSummary[];
  movingId: string | null;
  onMove: (dealId: string, stageId: string) => Promise<void>;
  onCreate: () => void;
  onAddStage: () => void;
  onEditStage: (stageId: string) => void;
  onDeleteStage: (stageId: string) => void;
}): ReactNode {
  const { formatMonthDayTime } = useWorkspaceFormatters();
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto pb-3">
      <div className="grid min-w-max auto-cols-[minmax(280px,1fr)] grid-flow-col gap-4">
        {pipeline.stages.map((stage, index) => {
          const stageDeals = deals.filter((deal) => deal.stageId === stage.id);
          const total = stageDeals.reduce((sum, deal) => sum + deal.value, 0);
          return (
            <section
              key={stage.id}
              className="w-[300px] rounded-xl bg-muted/50 p-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggedDealId) return;
                const deal = deals.find((item) => item.id === draggedDealId);
                if (deal && deal.stageId !== stage.id) void onMove(deal.id, stage.id);
                setDraggedDealId(null);
              }}
            >
              <header className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: stage.color }}
                      aria-hidden
                    />
                    <h2 className="font-heading font-medium">{stage.name}</h2>
                    <Badge variant="secondary">{stageDeals.length}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMoney(total, stageDeals[0]?.currency ?? "JPY")} · 成約確度
                    {stage.probability}%
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-xs" aria-label={`${stage.name}の操作`} />
                    }
                  >
                    <EllipsisVertical />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => onEditStage(stage.id)}>
                        <Pencil />
                        ステージを編集
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={pipeline.stages.length <= 1 || stageDeals.length > 0}
                        onClick={() => onDeleteStage(stage.id)}
                      >
                        <Trash2 />
                        ステージを削除
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </header>
              <div className="flex flex-col gap-3">
                {stageDeals.map((deal) => (
                  <Card
                    key={deal.id}
                    size="sm"
                    className={cn("bg-card", draggedDealId === deal.id && "opacity-50")}
                    draggable={movingId !== deal.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", deal.id);
                      setDraggedDealId(deal.id);
                    }}
                    onDragEnd={() => setDraggedDealId(null)}
                  >
                    <CardHeader>
                      <CardTitle>
                        <Link to="/deals/$id" params={{ id: deal.id }} className="hover:underline">
                          {deal.name}
                        </Link>
                      </CardTitle>
                      <CardDescription>{formatMoney(deal.value, deal.currency)}</CardDescription>
                      <CardAction>
                        <DealStatusBadge status={deal.status} />
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
                      {deal.companyName ? (
                        <span className="flex items-center gap-1.5">
                          <UsersRound className="size-3.5" />
                          {deal.companyName}
                        </span>
                      ) : null}
                      {deal.ownerName ? (
                        <span className="flex items-center gap-1.5">
                          <UserRound className="size-3.5" />
                          {deal.ownerName}
                        </span>
                      ) : null}
                      {deal.nextTaskAt ? (
                        <span className="flex items-center gap-1.5">
                          <Clock3 className="size-3.5" />
                          次のタスク {formatMonthDayTime(deal.nextTaskAt)}
                        </span>
                      ) : deal.openTaskCount > 0 ? (
                        <span>{deal.openTaskCount}件の未完了タスク</span>
                      ) : null}
                    </CardContent>
                    <div className="flex justify-between border-t px-3 pt-3">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="前のステージへ移動"
                        disabled={index === 0 || movingId === deal.id}
                        onClick={() => {
                          const previous = pipeline.stages[index - 1];
                          if (previous) void onMove(deal.id, previous.id);
                        }}
                      >
                        <ArrowLeft />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="次のステージへ移動"
                        disabled={index === pipeline.stages.length - 1 || movingId === deal.id}
                        onClick={() => {
                          const next = pipeline.stages[index + 1];
                          if (next) void onMove(deal.id, next.id);
                        }}
                      >
                        <ArrowRight />
                      </Button>
                    </div>
                  </Card>
                ))}
                {stageDeals.length === 0 ? (
                  <EmptyState compact title="このステージに商談はありません" />
                ) : null}
                {index === 0 ? (
                  <Button variant="ghost" size="sm" className="w-full" onClick={onCreate}>
                    <Plus data-icon="inline-start" />
                    商談を追加
                  </Button>
                ) : null}
              </div>
            </section>
          );
        })}
        {pipeline.stages.length < 20 ? (
          <section className="flex w-[300px] items-start">
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-24 w-full border-dashed"
              onClick={onAddStage}
            >
              <Plus data-icon="inline-start" />
              ステージを追加
            </Button>
          </section>
        ) : null}
      </div>
    </div>
  );
}
