import { Image as ImageIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { FormDialog, FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AssetPickerDialog } from "@/features/assets/asset-picker";
import {
  ContentDocumentEditor,
  defaultContentDocument,
} from "@/features/content/content-document-editor";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import type { ContentDocument } from "@openengage/core/web";

import { type LandingPageRow, useCreateLandingPage, useUpdateLandingPage } from "./website-api";

export function LandingPageEditorDialog({
  item,
  open,
  onOpenChange,
  onSaved,
  createMutation,
  updateMutation,
}: {
  item: LandingPageRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  createMutation: Pick<ReturnType<typeof useCreateLandingPage>, "mutateAsync">;
  updateMutation: Pick<ReturnType<typeof useUpdateLandingPage>, "mutateAsync">;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  const [content, setContent] = useState<ContentDocument>(
    item?.contentDocument ?? defaultContentDocument(720),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = getFormString(formData, "name").trim();
    const slug = getFormString(formData, "slug").trim();
    const payload = {
      name,
      status: getFormString(formData, "status") === "published" ? "published" : "draft",
      content,
    } as const;
    await run(async () => {
      if (item) {
        await updateMutation.mutateAsync({ id: item.id, ...payload, slug: slug || item.slug });
        toast.success("ページを更新しました");
      } else {
        await createMutation.mutateAsync({ ...payload, ...(slug ? { slug } : {}) });
        toast.success("ページを作成しました");
      }
      onSaved();
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "ランディングページを編集" : "ランディングページを作成"}
      description="保存するたびに新しいページバージョンを作成します。"
      className="sm:max-w-2xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "新しいバージョンを保存" : "ページを作成"}
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="管理用の名前"
          name="name"
          defaultValue={item?.name}
          placeholder="春のキャンペーン"
          required
        />
        <FormInput
          label="スラッグ"
          name="slug"
          defaultValue={item?.slug}
          description="未入力なら名前から自動生成します。"
          placeholder="spring-campaign"
        />
      </FieldGroup>
      <FormNativeSelect label="公開状態" name="status" defaultValue={item?.status ?? "draft"}>
        <FormSelectOption value="draft">下書き</FormSelectOption>
        <FormSelectOption value="published">公開</FormSelectOption>
      </FormNativeSelect>
      <ContentDocumentEditor value={content} onChange={setContent} />
      <Field>
        <FieldLabel>アセット画像</FieldLabel>
        <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <ImageIcon data-icon="inline-start" />
          画像ブロックを追加
        </Button>
        <FieldDescription>公開設定のアセットを本文の末尾へ追加します。</FieldDescription>
      </Field>
      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(asset) => {
          if (asset.publicUrl)
            setContent((current) => ({
              ...current,
              blocks: [
                ...current.blocks,
                {
                  id: `image-${crypto.randomUUID()}`,
                  type: "image",
                  src: asset.publicUrl ?? "",
                  alt: asset.name,
                },
              ],
            }));
          setPickerOpen(false);
        }}
      />
    </FormDialog>
  );
}
