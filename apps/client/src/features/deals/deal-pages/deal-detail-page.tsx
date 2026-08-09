import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArrowLeft,
  CalendarClock,
  Check,
  CircleDollarSign,
  CircleX,
  Clock3,
  Pencil,
  Plus,
  RotateCcw,
  UserRound,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
  AppDialog,
  ArchiveConfirm,
  EmptyState,
  LoadingButton,
  MetricCard,
  PageLayout,
} from "@/components/app-ui";
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
  dealDetailQueryOptions,
  dealOptionsQueryOptions,
  useArchiveDeal,
  useCreateDealTask,
  useDeleteDealTask,
  useUpdateDeal,
  useUpdateDealTask,
  type DealStatus,
  type DealTask,
} from "@/features/deals/deal-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { formatDate, formatMoney, formatMonthDayTime } from "@/lib/format";

import { DealForm, DealTaskForm, TaskRow } from "../deal-forms";
import { contactLabel, statusLabel } from "../deal-labels";
import { DealStatusBadge, DetailItem } from "../deal-widgets";

export function DealDetailPage({ dealId }: { dealId: string }): ReactNode {
  const navigate = useNavigate();
  const { data: detail } = useSuspenseQuery(dealDetailQueryOptions(dealId));
  const { data: options } = useSuspenseQuery(dealOptionsQueryOptions());
  const [showEdit, setShowEdit] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [editingTask, setEditingTask] = useState<DealTask | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const { deal, tasks } = detail;

  const updateDeal = useUpdateDeal();
  const archiveDeal = useArchiveDeal();
  const createDealTask = useCreateDealTask();
  const updateDealTask = useUpdateDealTask();
  const deleteDealTask = useDeleteDealTask();

  async function changeStatus(status: DealStatus): Promise<void> {
    setBusyAction(status);
    try {
      await updateDeal.mutateAsync({ id: deal.id, status });
      toast.success(
        status === "won"
          ? "商談を獲得にしました"
          : status === "lost"
            ? "商談を失注にしました"
            : "商談を再開しました",
      );
    } catch (caught) {
      toast.error(getErrorMessage(caught, "ステータスを変更できませんでした"));
    } finally {
      setBusyAction(null);
    }
  }

  async function removeTask(task: DealTask): Promise<void> {
    try {
      await deleteDealTask.mutateAsync({ dealId: deal.id, taskId: task.id });
      toast.success("タスクを削除しました");
    } catch (caught) {
      toast.error(getErrorMessage(caught, "タスクを削除できませんでした"));
    }
  }

  return (
    <PageLayout
      title={deal.name}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/deals" />}>
            <ArrowLeft data-icon="inline-start" />
            一覧
          </Button>
          <Button variant="outline" onClick={() => setShowEdit(true)}>
            <Pencil data-icon="inline-start" />
            編集
          </Button>
          {deal.status === "open" ? (
            <>
              <LoadingButton
                busy={busyAction === "won"}
                variant="outline"
                onClick={() => void changeStatus("won")}
              >
                <Check data-icon="inline-start" />
                獲得
              </LoadingButton>
              <LoadingButton
                busy={busyAction === "lost"}
                variant="outline"
                onClick={() => void changeStatus("lost")}
              >
                <CircleX data-icon="inline-start" />
                失注
              </LoadingButton>
            </>
          ) : (
            <LoadingButton
              busy={busyAction === "open"}
              variant="outline"
              onClick={() => void changeStatus("open")}
            >
              <RotateCcw data-icon="inline-start" />
              再開
            </LoadingButton>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <DealStatusBadge status={deal.status} />
        <Badge variant="outline">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: deal.stageColor }}
            aria-hidden
          />
          {deal.pipelineName} / {deal.stageName}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="商談金額"
          value={formatMoney(deal.value, deal.currency)}
          description={`成約確度 ${deal.stageProbability}%`}
          icon={<CircleDollarSign />}
        />
        <MetricCard
          label="完了予定日"
          value={deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "未設定"}
          description={deal.status === "open" ? "進行中" : statusLabel(deal.status)}
          icon={<CalendarClock />}
        />
        <MetricCard
          label="担当者"
          value={deal.ownerName ?? "未設定"}
          description={deal.ownerEmail ?? "担当者を設定してください"}
          icon={<UserRound />}
        />
        <MetricCard
          label="未完了タスク"
          value={`${deal.openTaskCount.toLocaleString()}件`}
          description={deal.nextTaskAt ? `次回 ${formatMonthDayTime(deal.nextTaskAt)}` : "予定なし"}
          icon={<Clock3 />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>タスク</CardTitle>
            <CardDescription>商談に紐づく次のアクションを管理します。</CardDescription>
            <CardAction>
              <Button onClick={() => setShowTask(true)}>
                <Plus data-icon="inline-start" />
                タスクを追加
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onEdit={() => setEditingTask(task)}
                onToggle={async () => {
                  try {
                    await updateDealTask.mutateAsync({
                      dealId: deal.id,
                      taskId: task.id,
                      status: task.status === "open" ? "completed" : "open",
                    });
                  } catch (caught) {
                    toast.error(getErrorMessage(caught, "タスクを更新できませんでした"));
                  }
                }}
                onDelete={() => void removeTask(task)}
              />
            ))}
            {tasks.length === 0 ? (
              <EmptyState
                compact
                title="タスクはまだありません"
                description="電話、メール、ミーティングなど次のアクションを登録しましょう。"
                action={
                  <Button variant="outline" onClick={() => setShowTask(true)}>
                    <Plus data-icon="inline-start" />
                    最初のタスクを追加
                  </Button>
                }
              />
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>関連先</CardTitle>
              <CardDescription>この商談に紐づく顧客情報</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <DetailItem
                label="連絡先"
                value={contactLabel(deal) || "未設定"}
                detail={deal.contactEmail}
              />
              <DetailItem label="会社" value={deal.companyName ?? "未設定"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>メモ</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {deal.description || "商談の説明はまだありません。"}
              </p>
            </CardContent>
          </Card>
          <ArchiveConfirm
            label={deal.name}
            trigger={<Button variant="destructive" className="self-start" />}
            triggerContent={
              <>
                <Archive data-icon="inline-start" />
                アーカイブ
              </>
            }
            onConfirm={() =>
              archiveDeal
                .mutateAsync({ id: deal.id })
                .then(async () => {
                  toast.success("商談をアーカイブしました");
                  await navigate({ to: "/deals" });
                })
                .catch((caught: unknown) => {
                  toast.error(getErrorMessage(caught, "商談をアーカイブできませんでした"));
                })
            }
          />
        </div>
      </div>

      <AppDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        title="商談を編集"
        description="商談情報と関連先を更新します。"
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      >
        <DealForm
          options={options}
          deal={deal}
          submitLabel="変更を保存"
          onSubmit={async (values) => {
            await updateDeal.mutateAsync({ id: deal.id, ...values });
            toast.success("商談を更新しました");
            setShowEdit(false);
          }}
        />
      </AppDialog>

      <AppDialog
        open={showTask}
        onOpenChange={setShowTask}
        title="タスクを追加"
        description="商談に対する次のアクションを登録します。"
      >
        <DealTaskForm
          members={options.members}
          submitLabel="タスクを追加"
          onSubmit={async (values) => {
            await createDealTask.mutateAsync({ dealId, ...values });
            toast.success("タスクを追加しました");
            setShowTask(false);
          }}
        />
      </AppDialog>

      <AppDialog
        open={Boolean(editingTask)}
        onOpenChange={(open) => {
          if (!open) setEditingTask(null);
        }}
        title="タスクを編集"
      >
        {editingTask ? (
          <DealTaskForm
            members={options.members}
            task={editingTask}
            submitLabel="変更を保存"
            onSubmit={async (values) => {
              await updateDealTask.mutateAsync({ dealId, taskId: editingTask.id, ...values });
              toast.success("タスクを更新しました");
              setEditingTask(null);
            }}
          />
        ) : null}
      </AppDialog>
    </PageLayout>
  );
}
