import { UploadCloud } from "lucide-react";
import { type DragEvent, type FormEvent, type ReactNode, useState } from "react";

import {
  ErrorAlert,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  FormTextarea,
  LoadingButton,
} from "@/components/app-ui";
import { AppDialog, ConfirmDialog, FormDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { formatBytes, type Asset, type AssetVisibility } from "@/features/assets/asset-api";
import { replaceAssetContent, uploadAssetFile } from "@/features/assets/asset-upload";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { cn } from "@/lib/utils";

type UploadState = "pending" | "uploading" | "done" | "error";

interface QueuedUpload {
  file: File;
  state: UploadState;
  percent: number;
  error?: string | undefined;
}

export function AssetUploadDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (count: number) => Promise<void>;
}): ReactNode {
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [visibility, setVisibility] = useState<AssetVisibility>("private");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  function addFiles(files: FileList | null): void {
    if (!files || files.length === 0) return;
    setQueue((current) => [
      ...current,
      ...[...files].map((file) => ({ file, state: "pending" as const, percent: 0 })),
    ]);
  }

  function drop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  function patch(index: number, changes: Partial<QueuedUpload>): void {
    setQueue((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...changes } : item)),
    );
  }

  // Sequential on purpose: a five-file drop must not open five concurrent
  // 100MB streams into the Worker.
  async function startUpload(): Promise<void> {
    setBusy(true);
    let succeeded = 0;
    for (const [index, item] of queue.entries()) {
      if (item.state === "done") continue;
      patch(index, { state: "uploading", percent: 0, error: undefined });
      try {
        await uploadAssetFile({
          file: item.file,
          visibility,
          onProgress: (percent) => patch(index, { percent }),
        });
        patch(index, { state: "done", percent: 100 });
        succeeded += 1;
      } catch (error) {
        patch(index, {
          state: "error",
          error: getErrorMessage(error, "アップロードに失敗しました"),
        });
      }
    }
    setBusy(false);
    if (succeeded > 0) {
      setQueue([]);
      await onUploaded(succeeded);
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title="アセットをアップロード"
      description="画像・eBook・スライドなど100MBまでのファイルを追加します。"
      className="sm:max-w-xl"
    >
      <FieldGroup>
        <Field>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            className={cn(
              "rounded-lg border-2 border-dashed p-8 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
            )}
          >
            <UploadCloud className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
            <FieldLabel
              htmlFor="asset-upload-input"
              className="inline-flex cursor-pointer underline underline-offset-4"
            >
              ファイルを選択
            </FieldLabel>
            <input
              id="asset-upload-input"
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                addFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <p className="mt-1 text-sm text-muted-foreground">
              またはここにドラッグ＆ドロップしてください。
            </p>
          </div>
        </Field>

        <FormNativeSelect
          label="公開設定"
          name="visibility"
          value={visibility}
          onChange={(event) => setVisibility(event.currentTarget.value as AssetVisibility)}
          description="公開にすると、ログイン不要のURLが発行されます。"
        >
          <FormSelectOption value="private">非公開</FormSelectOption>
          <FormSelectOption value="public">公開</FormSelectOption>
        </FormNativeSelect>

        {queue.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {queue.map((item, index) => (
              <li key={`${item.file.name}-${index}`} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{item.file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(item.file.size)}
                  </span>
                </div>
                <Progress
                  className="w-full"
                  value={item.percent}
                  variant={item.state === "error" ? "destructive" : "default"}
                  aria-label={`${item.file.name}の進捗`}
                />
                {item.error ? <p className="text-xs text-destructive">{item.error}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <LoadingButton
          busy={busy}
          busyLabel="アップロード中…"
          disabled={queue.length === 0}
          className="w-full"
          onClick={() => void startUpload()}
        >
          {queue.length > 0 ? `${queue.length}件をアップロード` : "アップロード"}
        </LoadingButton>
      </FieldGroup>
    </AppDialog>
  );
}

export function AssetEditDialog({
  asset,
  open,
  onOpenChange,
  onSubmit,
}: {
  asset: Asset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: {
    name: string;
    description: string;
    altText: string;
    visibility: AssetVisibility;
  }) => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("アセットを保存できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await onSubmit({
        name: getFormString(form, "name").trim(),
        description: getFormString(form, "description").trim(),
        altText: getFormString(form, "altText").trim(),
        visibility: getFormString(form, "visibility") === "public" ? "public" : "private",
      });
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="アセットを編集"
      description={`元のファイル名: ${asset.originalFilename}`}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="保存"
    >
      <FormInput label="名前" name="name" defaultValue={asset.name} required maxLength={191} />
      <FormTextarea
        label="説明"
        name="description"
        defaultValue={asset.description}
        rows={3}
        maxLength={2000}
      />
      {asset.kind === "image" ? (
        <FormInput
          label="代替テキスト"
          name="altText"
          defaultValue={asset.altText}
          maxLength={500}
          description="ランディングページやメールに埋め込んだときの alt 属性です。"
        />
      ) : (
        <input type="hidden" name="altText" value={asset.altText} />
      )}
      <FormNativeSelect
        label="公開設定"
        name="visibility"
        defaultValue={asset.visibility}
        description="非公開に戻すと、発行済みの公開URLは404になります。"
      >
        <FormSelectOption value="private">非公開</FormSelectOption>
        <FormSelectOption value="public">公開</FormSelectOption>
      </FormNativeSelect>
    </FormDialog>
  );
}

export function AssetReplaceDialog({
  asset,
  open,
  onOpenChange,
  onReplaced,
}: {
  asset: Asset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplaced: () => Promise<void>;
}): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function replace(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await replaceAssetContent(asset.id, { file, onProgress: setPercent });
      setFile(null);
      setPercent(0);
      await onReplaced();
    } catch (caught) {
      setError(getErrorMessage(caught, "差し替えできませんでした"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title="ファイルを差し替え"
      description="IDは変わらないため、埋め込み済みのURLはそのまま新しいファイルを指します。"
    >
      <FieldGroup>
        <FormInput
          label="新しいファイル"
          name="file"
          type="file"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          description="差し替えると公開URLの ?v= が変わり、キャッシュは自動的に切り替わります。"
        />
        {busy ? <Progress className="w-full" value={percent} aria-label="差し替えの進捗" /> : null}
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton
          busy={busy}
          busyLabel="差し替え中…"
          disabled={!file}
          className="w-full"
          onClick={() => void replace()}
        >
          差し替える
        </LoadingButton>
      </FieldGroup>
    </AppDialog>
  );
}

export function AssetDeleteConfirm({
  name,
  onConfirm,
}: {
  name: string;
  onConfirm: () => void | Promise<void>;
}): ReactNode {
  return (
    <ConfirmDialog
      title="完全に削除しますか？"
      description={`「${name}」はR2上のファイルごと削除され、公開URLは404になります。この操作は取り消せません。`}
      confirmLabel="完全に削除"
      icon={<UploadCloud />}
      triggerLabel={`${name}を完全に削除`}
      trigger={<Button size="sm" variant="ghost" />}
      triggerContent="完全に削除"
      onConfirm={onConfirm}
    />
  );
}
