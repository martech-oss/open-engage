import { Plus } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { DealTask } from "../../deal-api";
import { TaskRow } from "../../deal-forms";

export function DealTasks({
  tasks,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  tasks: DealTask[];
  onAdd: () => void;
  onEdit: (task: DealTask) => void;
  onToggle: (task: DealTask) => Promise<void>;
  onDelete: (task: DealTask) => void;
}): ReactNode {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>タスク</CardTitle>
        <CardDescription>商談に紐づく次のアクションを管理します。</CardDescription>
        <CardAction>
          <Button onClick={onAdd}>
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
            onEdit={() => onEdit(task)}
            onToggle={() => onToggle(task)}
            onDelete={() => onDelete(task)}
          />
        ))}
        {tasks.length === 0 ? (
          <EmptyState
            compact
            title="タスクはまだありません"
            description="電話、メール、ミーティングなど次のアクションを登録しましょう。"
            action={
              <Button variant="outline" onClick={onAdd}>
                <Plus data-icon="inline-start" />
                最初のタスクを追加
              </Button>
            }
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
