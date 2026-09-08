import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LandingPageVersion } from "@openengage/core/web";

interface ConversationJob {
  id: string;
  prompt: string;
  explanation: string | null;
  error: string | null;
  status: string;
  retryable?: boolean;
  baseVersionId?: string;
}
export function LandingPromptForm({
  pageId,
  prompt,
  onPromptChange,
  busy,
  generating,
  error,
  onSubmit,
}: {
  pageId: string;
  prompt: string;
  onPromptChange: (value: string) => void;
  busy: boolean;
  generating: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form
      id="landing-generation-form"
      onSubmit={(event) => void onSubmit(event)}
      className="space-y-3"
    >
      <label htmlFor="landing-prompt" className="grid gap-2 text-sm font-medium">
        {pageId ? "修正したいこと" : "作りたいページ"}
        <Textarea
          id="landing-prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          rows={6}
          required
          maxLength={12000}
          placeholder="対象者、課題、目的、掲載してよい実績や価格を具体的に入力してください。"
        />
      </label>
      <Button disabled={busy || generating}>
        {generating ? "生成しています…" : pageId ? "AIに修正を依頼" : "AIで作成"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
export function LandingConversation({
  jobs,
  currentVersionId,
  busy,
  onRetry,
}: {
  jobs: ConversationJob[];
  currentVersionId: string | null;
  busy: boolean;
  onRetry: (jobId: string) => Promise<void>;
}) {
  return (
    <div
      role="log"
      aria-label="AIとの会話"
      aria-live="polite"
      className="max-h-72 space-y-3 overflow-auto rounded-lg border p-3"
    >
      {jobs
        .slice()
        .reverse()
        .map((job) => (
          <article key={job.id} className="space-y-1">
            <p className="text-sm whitespace-pre-wrap">{job.prompt}</p>
            <p className="text-sm text-muted-foreground">
              {job.explanation ??
                job.error ??
                (job.status === "queued"
                  ? "生成待ち"
                  : job.status === "running"
                    ? "生成中"
                    : job.status)}
            </p>
            {job.status === "failed" && job.retryable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || job.baseVersionId !== currentVersionId}
                onClick={() => void onRetry(job.id)}
              >
                この生成を再試行
              </Button>
            )}
            {job.status === "failed" && job.retryable && job.baseVersionId !== currentVersionId && (
              <p className="text-xs text-muted-foreground">
                下書きが更新されています。最新の版から生成を依頼してください。
              </p>
            )}
          </article>
        ))}
      {!jobs.length && (
        <p className="text-sm text-muted-foreground">
          例：中小企業向けの業務改善相談ページ。落ち着いた青色で、相談フォームを設置してください。
        </p>
      )}
    </div>
  );
}

export function LandingVersionHistory({
  versions,
  currentVersionId,
  publishedVersionId,
  disabled,
  onPublish,
}: {
  versions: LandingPageVersion[];
  currentVersionId: string | null;
  publishedVersionId: string | null;
  disabled: boolean;
  onPublish: (id: string) => Promise<void>;
}) {
  return (
    <details>
      <summary className="cursor-pointer text-sm">版履歴と公開</summary>
      <ol className="mt-3 space-y-2">
        {versions.map((version) => (
          <li
            key={version.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span>
              第{version.version}版{" "}
              {version.id === publishedVersionId
                ? "（公開中）"
                : version.id === currentVersionId
                  ? "（下書き）"
                  : ""}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || version.id === publishedVersionId}
              onClick={() => void onPublish(version.id)}
            >
              {version.publishedAt ? "この版に戻す" : "この版を公開"}
            </Button>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function LandingPreviewPanel({
  html,
  mobile,
  onMobileChange,
  disabled,
  onPublish,
}: {
  html: string;
  mobile: boolean;
  onMobileChange: (value: boolean) => void;
  disabled: boolean;
  onPublish: () => void;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={!mobile ? "default" : "outline"}
          aria-pressed={!mobile}
          onClick={() => onMobileChange(false)}
        >
          PC
        </Button>
        <Button
          type="button"
          variant={mobile ? "default" : "outline"}
          aria-pressed={mobile}
          onClick={() => onMobileChange(true)}
        >
          スマートフォン
        </Button>
        <Button type="button" className="ml-auto" disabled={disabled} onClick={onPublish}>
          下書きを公開
        </Button>
      </div>
      {html ? (
        <iframe
          title="ランディングページのプレビュー"
          sandbox=""
          srcDoc={html}
          className="mx-auto h-[560px] max-w-full rounded-lg border bg-white"
          style={{ width: mobile ? 390 : "100%" }}
        />
      ) : (
        <div className="grid h-80 place-items-center rounded-lg border text-sm text-muted-foreground">
          生成したページのプレビューが表示されます
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        プレビュー内の送信と計測は無効です。公開済みの内容は、下書きを公開するまで変わりません。
      </p>
    </div>
  );
}
