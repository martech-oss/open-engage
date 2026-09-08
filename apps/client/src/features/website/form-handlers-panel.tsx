import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { getFormString } from "@/lib/form-data";
import { formHandlerWriteSchema } from "@openengage/core/web";

import {
  formHandlersQueryOptions,
  useCreateFormHandler,
  useDeleteFormHandler,
  useUpdateFormHandler,
  type SignupFormRow,
} from "./website-api";

export function FormHandlersPanel({
  forms,
  workspaceSlug,
}: {
  forms: SignupFormRow[];
  workspaceSlug: string;
}) {
  const query = useQuery(formHandlersQueryOptions()),
    create = useCreateFormHandler(),
    update = useUpdateFormHandler(),
    remove = useDeleteFormHandler();
  const [editing, setEditing] = useState<string | null>(null),
    [opened, setOpened] = useState(false),
    [error, setError] = useState("");
  const handler = query.data?.find((item) => item.id === editing);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const fieldMapping = Object.fromEntries(
      getFormString(data, "mapping")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => line.split("=").map((value) => value.trim())),
    );
    const parsed = formHandlerWriteSchema.safeParse({
      name: data.get("name"),
      slug: data.get("slug"),
      formId: data.get("formId"),
      fieldMapping,
      allowedDomains: getFormString(data, "domains")
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean),
      successUrl: data.get("successUrl"),
      failureUrl: data.get("failureUrl"),
      enabled: handler?.enabled ?? true,
    });
    if (!parsed.success) {
      setError(
        "入力内容を確認してください。マッピングは「外部項目=連絡先項目」で1行ずつ指定します。",
      );
      return;
    }
    try {
      if (editing) await update.mutateAsync({ id: editing, ...parsed.data });
      else await create.mutateAsync(parsed.data);
      setOpened(false);
      setEditing(null);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "保存できませんでした");
    }
  }
  return (
    <section className="mt-6 space-y-4 rounded-lg border p-5" aria-label="外部フォーム連携">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">外部フォーム連携</h2>
          <p className="text-sm text-muted-foreground">
            既存サイトのHTMLフォームやJSON送信を取り込みます。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setEditing(null);
            setOpened(true);
          }}
        >
          Form Handlerを追加
        </Button>
      </div>
      <ul className="space-y-3">
        {query.data?.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 rounded border p-3">
            <span className="font-medium">{item.name}</span>
            <code className="text-xs break-all">
              /fh/{workspaceSlug}/{item.slug}
            </code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(item.id);
                setOpened(true);
              }}
            >
              編集
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void update.mutateAsync({ ...item, enabled: !item.enabled })}
            >
              {item.enabled ? "停止" : "有効化"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                void remove.mutateAsync({ id: item.id }).catch((issue) => setError(String(issue)))
              }
            >
              削除
            </Button>
          </li>
        ))}
      </ul>
      {opened && (
        <form
          key={editing ?? "new"}
          onSubmit={(event) => void submit(event)}
          className="grid gap-4 sm:grid-cols-2"
        >
          <label htmlFor="handler-name" className="grid gap-1 text-sm">
            名前
            <Input id="handler-name" name="name" defaultValue={handler?.name} required />
          </label>
          <label htmlFor="handler-slug" className="grid gap-1 text-sm">
            スラッグ
            <Input
              id="handler-slug"
              name="slug"
              defaultValue={handler?.slug}
              pattern="[a-z0-9][a-z0-9-]*"
              required
            />
          </label>
          <label htmlFor="handler-formId" className="grid gap-1 text-sm">
            入力定義に使うフォーム
            <NativeSelect id="handler-formId" name="formId" defaultValue={handler?.formId} required>
              <NativeSelectOption value="">選択してください</NativeSelectOption>
              {forms.map((form) => (
                <NativeSelectOption key={form.id} value={form.id}>
                  {form.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label htmlFor="handler-domains" className="grid gap-1 text-sm">
            許可ドメイン
            <Input
              id="handler-domains"
              name="domains"
              defaultValue={handler?.allowedDomains.join(", ")}
              placeholder="example.com"
              required
            />
          </label>
          <label htmlFor="handler-mapping" className="grid gap-1 text-sm">
            項目マッピング
            <Textarea
              id="handler-mapping"
              name="mapping"
              rows={4}
              defaultValue={
                handler
                  ? Object.entries(handler.fieldMapping)
                      .map(([source, target]) => `${source}=${target}`)
                      .join("\n")
                  : "email_address=email"
              }
              required
            />
          </label>
          <p className="text-sm text-muted-foreground">
            外部項目名=連絡先項目キーで指定します。emailのマッピングは必須です。送信には8〜191文字のidempotencyKeyを含め、同じ送信の再試行には同じ値を使ってください。Turnstileは選択したフォームの設定を引き継ぎます。
          </p>
          <label htmlFor="handler-successUrl" className="grid gap-1 text-sm">
            成功時のURL
            <Input
              id="handler-successUrl"
              name="successUrl"
              type="url"
              defaultValue={handler?.successUrl}
              required
            />
          </label>
          <label htmlFor="handler-failureUrl" className="grid gap-1 text-sm">
            失敗時のURL
            <Input
              id="handler-failureUrl"
              name="failureUrl"
              type="url"
              defaultValue={handler?.failureUrl}
              required
            />
          </label>
          <div className="flex gap-2">
            <Button disabled={create.isPending || update.isPending}>保存</Button>
            <Button type="button" variant="ghost" onClick={() => setOpened(false)}>
              閉じる
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
