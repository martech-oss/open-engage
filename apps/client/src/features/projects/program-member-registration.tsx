import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ErrorAlert, FormInput, FormTextarea, LoadingButton } from "@/components/app-ui";
import { contactSearchDefaults, contactsQueryOptions } from "@/features/contacts/contact-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type { ProjectProgram } from "@openengage/core/projects";

import {
  useProgramInvalidator,
  programMemberImportQueryOptions,
  useImportProjectMembers,
  useMutateProjectMember,
} from "./program-api";
import { ProgramSelect } from "./program-fields";
export function ProgramMemberRegistration({
  id,
  program,
}: {
  id: string;
  program: ProjectProgram;
}) {
  const [contactQuery, setContactQuery] = useState("");
  const [contactId, setContactId] = useState("");
  const [statusId, setStatusId] = useState(program.publishedDefinition?.initialStatusId ?? "");
  const [csv, setCsv] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const invalidate = useProgramInvalidator();
  const job = useQuery({
    ...programMemberImportQueryOptions(id, jobId ?? ""),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (query.state.data?.status === "completed" ? false : 1000),
  });
  const rows = job.data?.rows ?? [];
  useEffect(() => {
    if (job.data?.status === "completed") void invalidate();
  }, [job.data?.status, invalidate]);
  const [error, setError] = useState("");
  const [importKey, setImportKey] = useState<string | null>(null);
  const contacts = useQuery({
    ...contactsQueryOptions({ ...contactSearchDefaults, q: contactQuery }),
  });
  const mutate = useMutateProjectMember();
  const importing = useImportProjectMembers();
  const statuses = program.publishedDefinition?.statuses ?? [];
  async function register() {
    setError("");
    try {
      await mutate.mutateAsync({
        id,
        contactId,
        statusId,
        source: "manual",
        idempotencyKey: crypto.randomUUID(),
      });
      setContactId("");
    } catch (cause) {
      setError(getErrorMessage(cause, "参加者を登録できませんでした"));
    }
  }
  async function upload() {
    const key = importKey ?? crypto.randomUUID();
    setImportKey(key);
    setError("");
    try {
      const result = await importing.mutateAsync({ id, csv, idempotencyKey: key });
      setJobId(result.jobId);
    } catch (cause) {
      setError(getErrorMessage(cause, "CSVを取り込めませんでした"));
    }
  }
  return (
    <div>
      {error && <ErrorAlert>{error}</ErrorAlert>}{" "}
      <details className="rounded-xl border bg-card p-4">
        <summary className="cursor-pointer font-medium">参加者を登録 / CSV取込</summary>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <FormInput
              name="contact-search"
              label="既存コンタクトを検索"
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="名前またはメールアドレス"
            />
            <ProgramSelect
              name="program-contact"
              label="登録するコンタクト"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              options={[
                { value: "", label: "選択してください" },
                ...(contacts.data?.items ?? []).map((c) => ({
                  value: c.id,
                  label: c.email ?? `${c.lastName ?? ""} ${c.firstName ?? ""}`,
                })),
              ]}
            />
            <ProgramSelect
              name="register-status"
              label="登録先ステータス"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
              options={statuses.map((s) => ({ value: s.id, label: s.label }))}
            />
            <LoadingButton
              busy={mutate.isPending}
              disabled={!contactId || !statusId}
              onClick={() => void register()}
            >
              参加者を登録
            </LoadingButton>
          </div>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              既存コンタクトの contactId または email と、任意の statusId
              を指定してください。不明なコンタクトは行ごとにエラーになります。1回1000行まで。
            </p>
            <label className="block text-sm">
              CSVファイル
              <input
                className="mt-2 block"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void file.text().then((text) => {
                      setCsv(text);
                      setImportKey(null);
                      setJobId(null);
                    });
                }}
              />
            </label>
            <FormTextarea
              name="program-csv"
              label="CSV内容"
              placeholder={"email,statusId\nperson@example.com,registered"}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setImportKey(null);
                setJobId(null);
              }}
              rows={5}
            />
            <LoadingButton
              busy={importing.isPending}
              disabled={!csv.trim()}
              onClick={() => void upload()}
            >
              CSVを取り込む
            </LoadingButton>
            {jobId && (
              <output>
                CSV受付済み: {jobId} — {job.data?.status === "completed" ? "完了" : "処理中"} (
                {job.data?.processed ?? 0} / {job.data?.total ?? "…"}行)
              </output>
            )}
            {job.error && (
              <ErrorAlert>{getErrorMessage(job.error, "進捗を取得できませんでした")}</ErrorAlert>
            )}
            {rows.length > 0 && (
              <output className="max-h-52 overflow-y-auto text-sm">
                <p>
                  {rows.filter((r) => r.ok).length}行成功 / {rows.filter((r) => !r.ok).length}
                  行エラー
                </p>
                {rows
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <p key={r.row}>
                      {r.row}行目: {r.error}
                    </p>
                  ))}
              </output>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
