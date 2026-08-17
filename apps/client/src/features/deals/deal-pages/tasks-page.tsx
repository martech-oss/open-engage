import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BriefcaseBusiness, Check } from "lucide-react";
import { type ReactNode } from "react";
import { toast } from "sonner";

import { FormNativeSelect, FormSelectOption, PageLayout } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import {
  tasksQueryOptions,
  useUpdateDealTask,
  type DealTaskListItem,
  type TaskSearch,
} from "@/features/deals/deal-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { formatMonthDayTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { taskTypeName } from "../deal-labels";

export function DealTasksPage({ search }: { search: TaskSearch }): ReactNode {
  const navigate = useNavigate();
  const { data: tasks } = useSuspenseQuery(tasksQueryOptions(search));
  const updateDealTask = useUpdateDealTask();

  async function toggleStatus(task: DealTaskListItem): Promise<void> {
    try {
      await updateDealTask.mutateAsync({
        dealId: task.dealId,
        taskId: task.id,
        status: task.status === "open" ? "completed" : "open",
      });
    } catch (caught) {
      toast.error(getErrorMessage(caught, "タスクを更新できませんでした"));
    }
  }

  const columns: DataTableColumn<DealTaskListItem>[] = [
    {
      key: "done",
      header: "",
      label: "完了",
      enableHiding: false,
      cell: (task) => (
        <Button
          variant={task.status === "completed" ? "secondary" : "outline"}
          size="icon-sm"
          aria-label={task.status === "completed" ? "未完了に戻す" : "完了にする"}
          onClick={(event) => {
            event.stopPropagation();
            void toggleStatus(task);
          }}
        >
          <Check />
        </Button>
      ),
      headClassName: "w-12 px-4",
      cellClassName: "px-4",
    },
    {
      key: "title",
      header: "タスク",
      sortValue: (task) => task.title.toLocaleLowerCase(),
      cell: (task) => {
        const overdue = task.status === "open" && task.dueAt && new Date(task.dueAt) < new Date();
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("font-medium", task.status === "completed" && "line-through")}>
              {task.title}
            </span>
            {overdue ? <Badge variant="destructive">期限超過</Badge> : null}
          </div>
        );
      },
      headClassName: "px-4",
      cellClassName: "px-4",
    },
    {
      key: "type",
      header: "種類",
      sortValue: (task) => taskTypeName(task.type),
      cell: (task) => <Badge variant="outline">{taskTypeName(task.type)}</Badge>,
    },
    {
      key: "deal",
      header: "Deal",
      sortValue: (task) => task.dealName.toLocaleLowerCase(),
      cell: (task) => (
        <Link
          to="/deals/$id"
          params={{ id: task.dealId }}
          className="font-medium hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {task.dealName}
        </Link>
      ),
    },
    {
      key: "dueAt",
      header: "期限",
      sortValue: (task) => task.dueAt ?? "",
      cell: (task) => (
        <span className="text-muted-foreground">
          {task.dueAt ? formatMonthDayTime(task.dueAt) : "期限なし"}
        </span>
      ),
    },
    {
      key: "assignee",
      header: "担当者",
      sortValue: (task) => (task.assigneeName ?? "").toLocaleLowerCase(),
      cell: (task) => (
        <span className="text-muted-foreground">{task.assigneeName ?? "未設定"}</span>
      ),
    },
    {
      key: "status",
      header: "状態",
      sortValue: (task) => task.status,
      cell: (task) =>
        task.status === "completed" ? (
          <Badge variant="secondary">完了</Badge>
        ) : (
          <Badge>未完了</Badge>
        ),
      headClassName: "px-4",
      cellClassName: "px-4",
    },
  ];

  return (
    <PageLayout title="Task">
      <Card>
        <CardContent>
          <FieldGroup className="max-w-52">
            <FormNativeSelect
              label="ステータス"
              name="status"
              value={search.status}
              onChange={(event) =>
                void navigate({
                  to: "/tasks",
                  search: { status: event.target.value as TaskSearch["status"] },
                })
              }
            >
              <FormSelectOption value="open">未完了</FormSelectOption>
              <FormSelectOption value="completed">完了</FormSelectOption>
              <FormSelectOption value="all">すべて</FormSelectOption>
            </FormNativeSelect>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="px-0">
          <DataTable
            showColumnVisibility
            columns={columns}
            rows={tasks}
            rowKey={(task) => task.id}
            caption="タスク一覧"
            emptyTitle={
              search.status === "completed"
                ? "完了したタスクはありません"
                : "タスクはまだありません"
            }
            emptyDescription="商談の詳細から次のアクションを追加できます。"
            emptyAction={
              <Button variant="outline" nativeButton={false} render={<Link to="/deals" />}>
                <BriefcaseBusiness data-icon="inline-start" />
                Dealを開く
              </Button>
            }
            onRowClick={(task) => void navigate({ to: "/deals/$id", params: { id: task.dealId } })}
          />
        </CardContent>
      </Card>
    </PageLayout>
  );
}
