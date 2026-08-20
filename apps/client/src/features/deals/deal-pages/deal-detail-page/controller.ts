import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { getErrorMessage } from "@/hooks/use-form-submission";

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
} from "../../deal-api";

export function useDealDetailController(dealId: string) {
  const navigate = useNavigate();
  const { data: detail } = useSuspenseQuery(dealDetailQueryOptions(dealId));
  const { data: options } = useSuspenseQuery(dealOptionsQueryOptions());
  const [showEdit, setShowEdit] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [editingTask, setEditingTask] = useState<DealTask | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const updateDeal = useUpdateDeal();
  const archiveDeal = useArchiveDeal();
  const createDealTask = useCreateDealTask();
  const updateDealTask = useUpdateDealTask();
  const deleteDealTask = useDeleteDealTask();
  const { deal, tasks } = detail;

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

  async function toggleTask(task: DealTask): Promise<void> {
    try {
      await updateDealTask.mutateAsync({
        dealId: deal.id,
        taskId: task.id,
        status: task.status === "open" ? "completed" : "open",
      });
    } catch (caught) {
      toast.error(getErrorMessage(caught, "タスクを更新できませんでした"));
    }
  }

  async function archive(): Promise<void> {
    try {
      await archiveDeal.mutateAsync({ id: deal.id });
      toast.success("商談をアーカイブしました");
      await navigate({ to: "/deals" });
    } catch (caught) {
      toast.error(getErrorMessage(caught, "商談をアーカイブできませんでした"));
    }
  }

  return {
    deal,
    tasks,
    options,
    showEdit,
    setShowEdit,
    showTask,
    setShowTask,
    editingTask,
    setEditingTask,
    busyAction,
    changeStatus,
    removeTask,
    toggleTask,
    archive,
    updateDeal: async (values: Parameters<typeof updateDeal.mutateAsync>[0]) => {
      await updateDeal.mutateAsync(values);
      toast.success("商談を更新しました");
      setShowEdit(false);
    },
    createTask: async (
      values: Omit<Parameters<typeof createDealTask.mutateAsync>[0], "dealId">,
    ) => {
      await createDealTask.mutateAsync({ dealId, ...values });
      toast.success("タスクを追加しました");
      setShowTask(false);
    },
    updateTask: async (
      task: DealTask,
      values: Omit<Parameters<typeof updateDealTask.mutateAsync>[0], "dealId" | "taskId">,
    ) => {
      await updateDealTask.mutateAsync({ dealId, taskId: task.id, ...values });
      toast.success("タスクを更新しました");
      setEditingTask(null);
    },
  };
}

export type DealDetailController = ReturnType<typeof useDealDetailController>;
