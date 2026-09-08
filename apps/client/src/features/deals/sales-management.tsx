import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { appBootstrapQueryOptions } from "@/lib/app-bootstrap";

import {
  salesMembersQueryOptions,
  assignmentGroupsQueryOptions,
  notificationsQueryOptions,
  useSaveAssignmentGroup,
  useDeleteAssignmentGroup,
  useReadNotification,
} from "./sales-api";

export function SalesManagement() {
  const { data: bootstrap } = useQuery(appBootstrapQueryOptions());
  const { data: members = [] } = useQuery(salesMembersQueryOptions());
  const { data: groups = [] } = useQuery(assignmentGroupsQueryOptions());
  const { data: notifications = [] } = useQuery(notificationsQueryOptions());
  const save = useSaveAssignmentGroup(),
    remove = useDeleteAssignmentGroup(),
    read = useReadNotification();
  const [id, setId] = useState<string | undefined>(),
    [name, setName] = useState(""),
    [mode, setMode] = useState<"fixed" | "round_robin">("round_robin"),
    [userIds, setUserIds] = useState<string[]>([]);
  const canManage = bootstrap?.workspace?.capabilities.manageMarketing ?? false;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-medium">通知</h2>
        {notifications.length === 0 && (
          <p className="text-sm text-muted-foreground">通知はありません</p>
        )}
        {notifications.map((notification) => (
          <div className="flex justify-between gap-2" key={notification.id}>
            <span>{notification.title}</span>
            {!notification.readAt && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => read.mutate({ id: notification.id })}
              >
                既読
              </Button>
            )}
          </div>
        ))}
      </section>
      {canManage && (
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-medium">営業割り当てグループ</h2>
          {groups.map((group) => (
            <div className="flex items-center gap-2" key={group.id}>
              <span className="grow">
                {group.name} · {group.mode === "fixed" ? "固定" : "順番に割り当て"}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setId(group.id);
                  setName(group.name);
                  setMode(group.mode);
                  setUserIds(group.userIds);
                }}
              >
                編集
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate({ id: group.id })}>
                削除
              </Button>
            </div>
          ))}
          <Input
            aria-label="グループ名"
            placeholder="グループ名"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <NativeSelect
            aria-label="割り当て方式"
            value={mode}
            onChange={(event) => setMode(event.target.value as "fixed" | "round_robin")}
          >
            <NativeSelectOption value="round_robin">順番に割り当て</NativeSelectOption>
            <NativeSelectOption value="fixed">固定担当者</NativeSelectOption>
          </NativeSelect>
          <div className="flex flex-wrap gap-3">
            {members.map((member) => (
              <label className="flex gap-1 text-sm" key={member.id}>
                <input
                  type="checkbox"
                  checked={userIds.includes(member.id)}
                  onChange={(event) =>
                    setUserIds((current) =>
                      event.target.checked
                        ? [...current, member.id]
                        : current.filter((id) => id !== member.id),
                    )
                  }
                />
                {member.name}
              </label>
            ))}
          </div>
          <Button
            disabled={save.isPending || !name.trim()}
            onClick={() =>
              save.mutate(
                { ...(id ? { id } : {}), name, mode, userIds },
                {
                  onSuccess: () => {
                    setId(undefined);
                    setName("");
                    setUserIds([]);
                  },
                },
              )
            }
          >
            {id ? "更新" : "グループ作成"}
          </Button>
          {(save.error ?? remove.error) && (
            <p role="alert" className="text-destructive">
              {(save.error ?? remove.error)?.message}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
