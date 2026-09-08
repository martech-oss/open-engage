import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ErrorAlert, FormInput, FormTextarea, LoadingButton } from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { ProjectMember, ProjectProgram } from "@openengage/core/projects";

import {
  projectMemberHistoryQueryOptions,
  projectMembersQueryOptions,
  useMutateProjectMember,
} from "./program-api";
import { ProgramSelect } from "./program-fields";
import { ProgramMemberRegistration } from "./program-member-registration";

export function ProgramMembersPanel({
  id,
  program,
  canManage,
}: {
  id: string;
  program: ProjectProgram;
  canManage: boolean;
}) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<ProjectMember | null>(null);
  const members = useQuery(projectMembersQueryOptions(id, query, offset, statusFilter));
  const { formatDateTime } = useWorkspaceFormatters();
  return (
    <div className="space-y-5">
      {canManage && <ProgramMemberRegistration id={id} program={program} />}
      <div className="grid gap-3 md:grid-cols-2">
        <FormInput
          name="member-search"
          label="参加者を検索"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <ProgramSelect
          name="member-status-filter"
          label="ステータスで絞り込み"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setOffset(0);
          }}
          options={[
            { value: "", label: "すべて" },
            ...Array.from(
              new Map(
                program.versions.flatMap((v) => v.definition.statuses).map((s) => [s.id, s]),
              ).values(),
            ).map((s) => ({ value: s.id, label: s.label })),
          ]}
        />
      </div>
      {members.error && (
        <ErrorAlert>{getErrorMessage(members.error, "参加者を取得できませんでした")}</ErrorAlert>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              {[
                "コンタクト",
                "参加ステータス",
                "定義版",
                "参加日時",
                "初回成果",
                "登録経路",
                "操作",
              ].map((label) => (
                <th key={label} className="p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.data?.items.map((row) => (
              <tr key={row.member.id} className="border-t">
                <td className="p-3">
                  {row.email ?? row.member.contactId}
                  <span className="block text-xs text-muted-foreground">
                    {row.lastName} {row.firstName}
                  </span>
                </td>
                <td className="p-3">{row.member.statusLabel}</td>
                <td className="p-3">v{row.member.definitionVersion}</td>
                <td className="p-3">{formatDateTime(row.member.joinedAt)}</td>
                <td className="p-3">
                  {row.member.firstSuccessAt ? formatDateTime(row.member.firstSuccessAt) : "未達成"}
                </td>
                <td className="p-3">{row.member.source}</td>
                <td className="p-3">
                  <Button size="sm" variant="outline" onClick={() => setSelected(row.member)}>
                    {canManage ? "進捗・訂正・履歴" : "履歴"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.data?.total === 0 && (
          <p className="p-8 text-center text-muted-foreground">まだ参加者がいません</p>
        )}
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>{members.data?.total ?? 0}人</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            前へ
          </Button>
          <Button
            variant="outline"
            disabled={offset + 50 >= (members.data?.total ?? 0)}
            onClick={() => setOffset(offset + 50)}
          >
            次へ
          </Button>
        </div>
      </div>
      {selected && (
        <MemberHistoryDialog
          key={selected.id}
          id={id}
          member={selected}
          program={program}
          canManage={canManage}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
function MemberHistoryDialog({
  id,
  member,
  program,
  canManage,
  onClose,
}: {
  id: string;
  member: ProjectMember;
  program: ProjectProgram;
  canManage: boolean;
  onClose: () => void;
}) {
  const history = useQuery(projectMemberHistoryQueryOptions(id, member.contactId));
  const mutate = useMutateProjectMember();
  const [statusId, setStatusId] = useState(member.statusId);
  const [mode, setMode] = useState<"progress" | "correction">("progress");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const { formatDateTime } = useWorkspaceFormatters();
  const definition = program.versions.find(
    (v) => v.version === member.definitionVersion,
  )?.definition;
  async function save() {
    setError("");
    try {
      await mutate.mutateAsync({
        id,
        contactId: member.contactId,
        statusId,
        source: "manual",
        mode,
        ...(mode === "correction" ? { reason } : {}),
        expectedRevision: member.revision,
        idempotencyKey: crypto.randomUUID(),
      });
      onClose();
    } catch (cause) {
      setError(getErrorMessage(cause, "進捗を更新できませんでした"));
    }
  }
  return (
    <AppDialog
      open
      title="参加者の進捗と履歴"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="space-y-4">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {canManage && (
          <>
            <ProgramSelect
              name="member-mode"
              label="更新方法"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              options={[
                { value: "progress", label: "通常の進捗（前進）" },
                { value: "correction", label: "手動訂正（成果集計も訂正）" },
              ]}
            />
            <ProgramSelect
              name="member-status"
              label={`更新先ステータス（第${member.definitionVersion}版）`}
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
              options={(definition?.statuses ?? []).map((s) => ({ value: s.id, label: s.label }))}
            />
            {mode === "correction" && (
              <FormTextarea
                name="correction-reason"
                label="訂正理由"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            <LoadingButton
              busy={mutate.isPending}
              disabled={mode === "correction" && !reason.trim()}
              onClick={() => void save()}
            >
              {mode === "correction" ? "理由を記録して訂正" : "進捗を更新"}
            </LoadingButton>
          </>
        )}
        <ol className="space-y-3 border-t pt-4">
          {history.data?.map((t) => (
            <li key={t.id} className="rounded border p-3 text-sm">
              <p className="font-medium">
                {t.statusLabel} · 第{t.definitionVersion}版 ·{" "}
                {t.mode === "correction" ? "訂正" : t.previousStatusId ? "進捗" : "参加"}
              </p>
              <p>
                {formatDateTime(t.occurredAt)} · {t.source}
              </p>
              {t.reason && <p>理由: {t.reason}</p>}
              <p className="text-muted-foreground">
                初回成果: {t.firstSuccessAt ? formatDateTime(t.firstSuccessAt) : "未達成"}
              </p>
            </li>
          ))}
        </ol>
        {history.error && (
          <ErrorAlert>{getErrorMessage(history.error, "履歴を取得できませんでした")}</ErrorAlert>
        )}
      </div>
    </AppDialog>
  );
}
