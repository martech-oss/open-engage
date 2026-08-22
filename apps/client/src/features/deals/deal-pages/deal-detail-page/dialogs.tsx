import type { ComponentProps, ReactNode } from "react";

import { AppDialog } from "@/components/app-ui/dialogs";

import type { DealDetailData, DealOptions, DealTask } from "../../deal-api";
import { DealForm, DealTaskForm } from "../../deal-forms";

export function DealDialogs({
  deal,
  options,
  showEdit,
  onShowEditChange,
  showTask,
  onShowTaskChange,
  editingTask,
  onEditingTaskChange,
  onUpdateDeal,
  onCreateTask,
  onUpdateTask,
}: {
  deal: DealDetailData["deal"];
  options: DealOptions;
  showEdit: boolean;
  onShowEditChange: (open: boolean) => void;
  showTask: boolean;
  onShowTaskChange: (open: boolean) => void;
  editingTask: DealTask | null;
  onEditingTaskChange: (task: DealTask | null) => void;
  onUpdateDeal: ComponentProps<typeof DealForm>["onSubmit"];
  onCreateTask: ComponentProps<typeof DealTaskForm>["onSubmit"];
  onUpdateTask: (
    task: DealTask,
    values: Parameters<ComponentProps<typeof DealTaskForm>["onSubmit"]>[0],
  ) => Promise<void>;
}): ReactNode {
  return (
    <>
      <AppDialog
        open={showEdit}
        onOpenChange={onShowEditChange}
        title="商談を編集"
        description="商談情報と関連先を更新します。"
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      >
        <DealForm options={options} deal={deal} submitLabel="変更を保存" onSubmit={onUpdateDeal} />
      </AppDialog>
      <AppDialog
        open={showTask}
        onOpenChange={onShowTaskChange}
        title="タスクを追加"
        description="商談に対する次のアクションを登録します。"
      >
        <DealTaskForm
          members={options.members}
          submitLabel="タスクを追加"
          onSubmit={onCreateTask}
        />
      </AppDialog>
      <AppDialog
        open={Boolean(editingTask)}
        onOpenChange={(open) => {
          if (!open) onEditingTaskChange(null);
        }}
        title="タスクを編集"
      >
        {editingTask ? (
          <DealTaskForm
            members={options.members}
            task={editingTask}
            submitLabel="変更を保存"
            onSubmit={(values) => onUpdateTask(editingTask, values)}
          />
        ) : null}
      </AppDialog>
    </>
  );
}
