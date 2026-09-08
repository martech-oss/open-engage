import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { appBootstrapQueryOptions } from "@/lib/app-bootstrap";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { DealTaskType } from "@openengage/core/deals";

import {
  useUpdateTaskResource,
  useDeleteTaskResource,
  salesMembersQueryOptions,
  assignmentGroupsQueryOptions,
  contactTasksQueryOptions,
  useCreateContactTask,
  useSalesHandoff,
  useSetTaskStatus,
} from "./sales-api";

export function ContactSales({ contactId }: { contactId: string }) {
  const { toDateTimeLocal, fromDateTimeLocal, formatDateTime } = useWorkspaceFormatters();
  const { data: bootstrap } = useQuery(appBootstrapQueryOptions());
  const { data: members = [] } = useQuery(salesMembersQueryOptions());
  const { data: groups = [] } = useQuery(assignmentGroupsQueryOptions());
  const { data: tasks = [] } = useQuery(contactTasksQueryOptions(contactId));
  const handoff = useSalesHandoff(),
    create = useCreateContactTask(),
    status = useSetTaskStatus(),
    update = useUpdateTaskResource(),
    remove = useDeleteTaskResource();
  const [type, setType] = useState<DealTaskType>("task");
  const [editingId, setEditingId] = useState<string | null>(null),
    [notes, setNotes] = useState("");
  const [title, setTitle] = useState("営業フォロー"),
    [assignment, setAssignment] = useState(""),
    [dueAt, setDueAt] = useState(""),
    [preserveOwner, setPreserveOwner] = useState(true);
  const executionKey = useRef<string | null>(null);
  const groupSelected = assignment.startsWith("group:");
  const canManage = bootstrap?.workspace?.capabilities.manageMarketing ?? false;
  const error = handoff.error ?? create.error ?? status.error ?? update.error ?? remove.error;
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">営業・タスク</h3>
      {tasks.map((task) => (
        <div key={task.id} className="flex justify-between gap-2">
          <span>
            {task.title} · {task.assigneeName ?? "未割当"}
            {task.dueAt ? ` · ${formatDateTime(task.dueAt)}` : ""}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canManage}
            onClick={() => {
              setEditingId(task.id);
              setTitle(task.title);
              setType(task.type);
              setNotes(task.notes);
              setAssignment(task.assignedUserId ? `user:${task.assignedUserId}` : "");
              setDueAt(task.dueAt ? toDateTimeLocal(task.dueAt) : "");
            }}
          >
            編集
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canManage || remove.isPending}
            onClick={() => remove.mutate({ taskId: task.id })}
          >
            削除
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canManage || status.isPending}
            onClick={() =>
              status.mutate({
                taskId: task.id,
                status: task.status === "open" ? "completed" : "open",
              })
            }
          >
            {task.status === "open" ? "完了" : "再開"}
          </Button>
        </div>
      ))}
      {canManage && (
        <>
          <Input
            aria-label="タスク名"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <NativeSelect
            aria-label="タスク種類"
            value={type}
            onChange={(event) => setType(event.target.value as DealTaskType)}
          >
            <NativeSelectOption value="task">タスク</NativeSelectOption>
            <NativeSelectOption value="call">電話</NativeSelectOption>
            <NativeSelectOption value="email">メール</NativeSelectOption>
            <NativeSelectOption value="meeting">会議</NativeSelectOption>
          </NativeSelect>
          <Input
            aria-label="タスクメモ"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <NativeSelect
            aria-label="営業担当の割り当て"
            value={assignment}
            onChange={(event) => setAssignment(event.target.value)}
          >
            <NativeSelectOption value="">指定なし</NativeSelectOption>
            {members.map((member) => (
              <NativeSelectOption key={member.id} value={`user:${member.id}`}>
                {member.name}
              </NativeSelectOption>
            ))}
            {!editingId &&
              groups.map((group) => (
                <NativeSelectOption key={group.id} value={`group:${group.id}`}>
                  {group.name} ({group.mode})
                </NativeSelectOption>
              ))}
          </NativeSelect>
          <Input
            aria-label="期限"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={preserveOwner}
              onChange={(event) => setPreserveOwner(event.target.checked)}
            />
            有効な現在の担当者を保持
          </label>
          {groupSelected && (
            <p className="text-sm text-muted-foreground">
              グループへの割り当ては「営業へ引き継ぐ」から実行してください。タスク追加には個人の担当者を選択してください。
            </p>
          )}
          <div className="flex gap-2">
            {!editingId && (
              <Button
                disabled={handoff.isPending || !title.trim()}
                onClick={() => {
                  executionKey.current ??= crypto.randomUUID();
                  handoff.mutate(
                    {
                      contactId,
                      title,
                      executionKey: executionKey.current,
                      preserveOwner,
                      ...(assignment.startsWith("group:")
                        ? { groupId: assignment.slice(6) }
                        : assignment.startsWith("user:")
                          ? { ownerUserId: assignment.slice(5) }
                          : {}),
                      dueAt: dueAt ? fromDateTimeLocal(dueAt) : null,
                    },
                    {
                      onSuccess: () => {
                        executionKey.current = null;
                      },
                    },
                  );
                }}
              >
                営業へ引き継ぐ
              </Button>
            )}
            <Button
              variant="outline"
              disabled={create.isPending || update.isPending || !title.trim() || groupSelected}
              onClick={() => {
                if (groupSelected) return;
                const fields = {
                  type,
                  title,
                  notes,
                  dueAt: dueAt ? fromDateTimeLocal(dueAt) : null,
                  assignedUserId: assignment.startsWith("user:") ? assignment.slice(5) : null,
                };
                if (editingId)
                  update.mutate(
                    { taskId: editingId, ...fields },
                    {
                      onSuccess: () => {
                        setEditingId(null);
                        setNotes("");
                      },
                    },
                  );
                else create.mutate({ contactId, ...fields });
              }}
            >
              {editingId ? "タスク更新" : "タスク追加"}
            </Button>
            {editingId && (
              <Button variant="ghost" onClick={() => setEditingId(null)}>
                キャンセル
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
    </section>
  );
}
