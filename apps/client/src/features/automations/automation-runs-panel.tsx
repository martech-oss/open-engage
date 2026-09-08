import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type { AutomationRun } from "@openengage/core/automations";

import {
  automationEnrollmentsQueryOptions,
  automationRunsQueryOptions,
  automationRunDetailQueryOptions,
  automationEnrollmentDetailQueryOptions,
  usePreviewAutomationRun,
  useStartAutomationRun,
  useCancelAutomationRun,
  useCancelAutomationEnrollment,
} from "./automation-api";
const statusLabel: Record<string, string> = {
  enrolling: "登録中",
  running: "実行中",
  completed: "完了",
  cancelled: "キャンセル",
  failed: "失敗",
  active: "実行中",
  pending: "待機中",
  enrolled: "登録済み",
  skipped: "スキップ",
  succeeded: "成功",
  leased: "処理待ち",
  queued: "処理待ち",
};
export function AutomationRunProgress({ run }: { run: AutomationRun }) {
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>対象者 {run.targetCount}人</span>
        <span>登録済み {run.enrolledCount}人</span>
        <span>登録待ち {run.pendingCount}人</span>
        <span>スキップ {run.skippedCount}人</span>
        <span>登録失敗 {run.failedCount}人</span>
      </div>
      <progress
        className="w-full"
        max={Math.max(run.targetCount, 1)}
        value={run.enrolledCount + run.skippedCount + run.failedCount}
        aria-label="対象者の登録進捗"
      />
      <p className="text-sm">
        登録作業: {run.enrollmentCompletedAt ? "完了" : "処理中"} · フロー完了{" "}
        {run.flowCompletedCount}人 / 実行中 {run.flowActiveCount}人 / 失敗 {run.flowFailedCount}人
      </p>
      {run.lastError ? (
        <p role="alert" className="text-destructive">
          {run.lastError}
        </p>
      ) : null}
    </div>
  );
}
export function AutomationRunsPanel({ id, canStart }: { id: string; canStart: boolean }) {
  const { data: runs = [], error } = useQuery(automationRunsQueryOptions(id));
  const preview = usePreviewAutomationRun(),
    start = useStartAutomationRun();
  const [selected, setSelected] = useState<string | null>(null),
    [requestId, setRequestId] = useState("");
  const [notice, setNotice] = useState("");
  async function inspect() {
    setNotice("");
    try {
      await preview.mutateAsync({ id });
      setRequestId(crypto.randomUUID());
    } catch (error) {
      setNotice(getErrorMessage(error, "対象者を確認できませんでした"));
    }
  }
  async function execute() {
    if (!preview.data) return;
    setNotice("");
    try {
      const run = await start.mutateAsync({ id, requestId, versionId: preview.data.versionId });
      setSelected(run.id);
      preview.reset();
    } catch (error) {
      setNotice(getErrorMessage(error, "実行できませんでした"));
    }
  }
  return (
    <section className="space-y-5 p-5 lg:p-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">実行履歴</h2>
        {canStart ? (
          <Button disabled={preview.isPending} onClick={() => void inspect()}>
            対象者を確認して実行
          </Button>
        ) : null}
      </div>
      {notice || error ? (
        <p role="alert" className="text-destructive">
          {notice || getErrorMessage(error, "実行履歴を取得できませんでした")}
        </p>
      ) : null}
      {preview.data ? (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">現在の対象者: {preview.data.count}人</h3>
          <p className="text-sm text-muted-foreground">
            実行開始時の対象者を固定します。再登録条件やアーカイブ状態は登録直前に確認します。
          </p>
          <ul className="text-sm">
            {preview.data.sample.map((contact) => (
              <li key={contact.id}>{contact.email ?? contact.id}</li>
            ))}
          </ul>
          <Button disabled={start.isPending} onClick={() => void execute()}>
            この公開版で実行開始
          </Button>
        </div>
      ) : null}
      {runs.length === 0 ? (
        <p className="text-muted-foreground">まだバッチ実行はありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>開始日時・予定枠</th>
                <th>状態</th>
                <th>登録 / 対象</th>
                <th>フロー完了</th>
                <th>失敗</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t">
                  <td>
                    <button
                      type="button"
                      className="py-3 text-left underline"
                      onClick={() => setSelected(run.id)}
                    >
                      {new Date(run.createdAt).toLocaleString()}
                      <small className="block">
                        {run.slot.startsWith("manual:") ? "手動実行" : run.slot}
                      </small>
                    </button>
                  </td>
                  <td>{statusLabel[run.status]}</td>
                  <td>
                    {run.enrolledCount} / {run.targetCount}
                  </td>
                  <td>{run.flowCompletedCount}</td>
                  <td>{run.failedCount + run.flowFailedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected ? <AutomationRunDetails key={selected} id={id} runId={selected} /> : null}
      <EnrollmentLookup id={id} />
    </section>
  );
}
function AutomationRunDetails({ id, runId }: { id: string; runId: string }) {
  const [cursor, setCursor] = useState<string | undefined>(),
    [enrollmentId, setEnrollmentId] = useState<string | null>(null),
    [error, setError] = useState("");
  const detail = useQuery(automationRunDetailQueryOptions(id, runId, cursor)),
    cancel = useCancelAutomationRun();
  if (detail.error)
    return <p role="alert">{getErrorMessage(detail.error, "実行詳細を取得できませんでした")}</p>;
  if (!detail.data) return <p>実行詳細を読み込み中…</p>;
  const { run, targets, nextCursor } = detail.data;
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex justify-between gap-4">
        <h3 className="font-semibold">実行詳細 · {statusLabel[run.status]}</h3>
        {["enrolling", "running"].includes(run.status) ? (
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() =>
              void cancel
                .mutateAsync({ id, runId })
                .catch((error) => setError(getErrorMessage(error, "キャンセルできませんでした")))
            }
          >
            実行と子フローをキャンセル
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <AutomationRunProgress run={run} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>連絡先</th>
              <th>登録状態</th>
              <th>フロー状態</th>
              <th>スキップ理由・失敗内容</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((target) => (
              <tr key={target.contactId} className="border-t">
                <td className="py-2">
                  {target.enrollmentId ? (
                    <button
                      className="underline"
                      onClick={() => setEnrollmentId(target.enrollmentId)}
                    >
                      {target.contactId}
                    </button>
                  ) : (
                    target.contactId
                  )}
                </td>
                <td>{statusLabel[target.status] ?? target.status}</td>
                <td>
                  {target.flowStatus ? (statusLabel[target.flowStatus] ?? target.flowStatus) : "—"}
                </td>
                <td className="max-w-md break-words">
                  {target.reason === "archived_or_reentry"
                    ? "アーカイブ済み・再登録条件に一致しない"
                    : target.reason === "cancelled"
                      ? "キャンセル"
                      : target.reason}
                  {target.lastError ? (
                    <span role="alert" className="text-destructive">
                      {target.lastError}（試行 {target.attempts}回）
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        {cursor ? (
          <Button variant="outline" onClick={() => setCursor(undefined)}>
            先頭へ
          </Button>
        ) : null}
        {nextCursor ? (
          <Button variant="outline" onClick={() => setCursor(nextCursor)}>
            次の対象者
          </Button>
        ) : null}
      </div>
      {enrollmentId ? <AutomationEnrollmentHistory id={id} enrollmentId={enrollmentId} /> : null}
    </section>
  );
}
function EnrollmentLookup({ id }: { id: string }) {
  const { data: enrollments = [], error } = useQuery(automationEnrollmentsQueryOptions(id));
  const [value, setValue] = useState(""),
    [selected, setSelected] = useState("");
  return (
    <details open>
      <summary className="cursor-pointer">すべての参加履歴（最新100件）</summary>
      {error ? <p role="alert">参加一覧を取得できませんでした。</p> : null}
      <ul className="mt-3 space-y-2">
        {enrollments.map((enrollment) => (
          <li key={enrollment.id} className="border-b pb-2 text-sm">
            <button className="underline" onClick={() => setSelected(enrollment.id)}>
              {enrollment.contactId} · {statusLabel[enrollment.status] ?? enrollment.status} ·{" "}
              {new Date(enrollment.enteredAt).toLocaleString()}
            </button>
            {enrollment.parentJobId ? <span>（子フロー）</span> : null}
            {enrollment.lastError ? (
              <p role="alert" className="text-destructive">
                {enrollment.lastError}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="my-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSelected(value.trim());
        }}
      >
        <input
          className="rounded border p-2"
          aria-label="参加ID"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="APIで返された参加ID"
        />
        <Button type="submit" disabled={!value.trim()}>
          詳細を表示
        </Button>
      </form>
      {selected ? <AutomationEnrollmentHistory id={id} enrollmentId={selected} /> : null}
    </details>
  );
}
export function AutomationEnrollmentHistory({
  id,
  enrollmentId,
}: {
  id: string;
  enrollmentId: string;
}) {
  const detail = useQuery(automationEnrollmentDetailQueryOptions(id, enrollmentId)),
    cancel = useCancelAutomationEnrollment();
  const [child, setChild] = useState<{ id: string; enrollmentId: string } | null>(null),
    [error, setError] = useState("");
  if (detail.error)
    return <p role="alert">{getErrorMessage(detail.error, "参加履歴を取得できませんでした")}</p>;
  if (!detail.data) return <p>参加履歴を読み込み中…</p>;
  const enrollment = detail.data;
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h4 className="font-medium">
        参加履歴 · {statusLabel[enrollment.status] ?? enrollment.status}
      </h4>
      <p className="text-xs">
        参加ID: {enrollment.id} · 公開版: {enrollment.automationVersionId}
      </p>
      {enrollment.status === "active" ||
      enrollment.children.some((item) => item.status === "active") ? (
        <Button
          variant="outline"
          disabled={cancel.isPending}
          onClick={() =>
            void cancel
              .mutateAsync({ id, enrollmentId })
              .catch((error) => setError(getErrorMessage(error, "キャンセルできませんでした")))
          }
        >
          参加と子フローを停止
        </Button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <ol className="space-y-2 text-sm">
        {enrollment.jobs.map((job) => (
          <li key={job.id} className="rounded bg-muted p-3">
            <strong>{job.nodeId}</strong> ·{" "}
            {job.payload.includes("waitingChild") && job.status === "pending"
              ? "子フローの完了待ち"
              : (statusLabel[job.status] ?? job.status)}{" "}
            · 試行 {job.attempts}回
            {job.status === "pending" && !job.payload.includes("waitingChild") ? (
              <span> · 予定 {job.dueAt}</span>
            ) : null}
            {job.lastError ? (
              <p role="alert" className="break-words text-destructive">
                {job.lastError}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {enrollment.children.length ? (
        <div>
          <h5 className="font-medium">子フロー</h5>
          {enrollment.children.map((item) => (
            <button
              key={item.id}
              className="block py-2 text-sm underline"
              onClick={() => setChild({ id: item.automationId, enrollmentId: item.id })}
            >
              {item.automationId} · {statusLabel[item.status] ?? item.status}
            </button>
          ))}
        </div>
      ) : null}
      {child ? <AutomationEnrollmentHistory key={child.enrollmentId} {...child} /> : null}
    </div>
  );
}
