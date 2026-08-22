import { CalendarClock, CircleDollarSign, Clock3, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, PageLayout } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { statusLabel } from "../../deal-labels";
import { DealStatusBadge } from "../../deal-widgets";
import { useDealDetailController } from "./controller";
import { DealDialogs } from "./dialogs";
import { DealHeaderActions } from "./header-actions";
import { DealSidebar } from "./sidebar";
import { DealTasks } from "./tasks";

export function DealDetailPage({ dealId }: { dealId: string }): ReactNode {
  const { formatDate, formatMonthDayTime } = useWorkspaceFormatters();
  const controller = useDealDetailController(dealId);
  const { deal } = controller;
  return (
    <PageLayout
      title={deal.name}
      action={
        <DealHeaderActions
          deal={deal}
          busyAction={controller.busyAction}
          onEdit={() => controller.setShowEdit(true)}
          onStatusChange={(status) => void controller.changeStatus(status)}
        />
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
        <DealTasks
          tasks={controller.tasks}
          onAdd={() => controller.setShowTask(true)}
          onEdit={controller.setEditingTask}
          onToggle={controller.toggleTask}
          onDelete={(task) => void controller.removeTask(task)}
        />
        <DealSidebar deal={deal} onArchive={controller.archive} />
      </div>

      <DealDialogs
        deal={deal}
        options={controller.options}
        showEdit={controller.showEdit}
        onShowEditChange={controller.setShowEdit}
        showTask={controller.showTask}
        onShowTaskChange={controller.setShowTask}
        editingTask={controller.editingTask}
        onEditingTaskChange={controller.setEditingTask}
        onUpdateDeal={(values) => controller.updateDeal({ id: deal.id, ...values })}
        onCreateTask={controller.createTask}
        onUpdateTask={controller.updateTask}
      />
    </PageLayout>
  );
}
