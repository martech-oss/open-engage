import { type FormEvent, type ReactNode } from "react";

import { FormInput } from "@/components/app-ui";
import { FormDialog } from "@/components/app-ui/dialogs";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";

import {
  type CustomRedirectRow,
  useCreateCustomRedirect,
  useUpdateCustomRedirect,
} from "./website-api";

export function CustomRedirectEditorDialog({
  item,
  open,
  onOpenChange,
  onSaved,
  createMutation,
  updateMutation,
}: {
  item: CustomRedirectRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  createMutation: Pick<ReturnType<typeof useCreateCustomRedirect>, "mutateAsync">;
  updateMutation: Pick<ReturnType<typeof useUpdateCustomRedirect>, "mutateAsync">;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      name: getFormString(formData, "name"),
      slug: getFormString(formData, "slug"),
      destinationUrl: getFormString(formData, "destinationUrl"),
    } as const;
    await run(() =>
      saveResource({
        editing: item,
        payload,
        create: (data) => createMutation.mutateAsync(data),
        update: (id, data) => updateMutation.mutateAsync({ id, ...data }),
        createdMessage: "計測用リンクを作成しました",
        updatedMessage: "計測用リンクを更新しました",
        onSaved,
      }),
    );
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "計測用リンクを編集" : "計測用リンクを作成"}
      description="遷移先と、URLに使うスラッグを設定します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "リンクを作成"}
    >
      <FormInput
        label="管理用の名前"
        name="name"
        defaultValue={item?.name}
        placeholder="春キャンペーンのバナー"
        required
      />
      <FormInput
        label="スラッグ"
        name="slug"
        defaultValue={item?.slug}
        description="計測用URLの末尾に使います。英小文字、数字、ハイフンのみ。"
        placeholder="spring-campaign"
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        required
      />
      <FormInput
        label="遷移先URL"
        name="destinationUrl"
        type="url"
        defaultValue={item?.destinationUrl}
        description="スラッグを変更しても、既に配布済みの旧URLは無効になります。"
        placeholder="https://example.com/campaign/spring"
        required
      />
    </FormDialog>
  );
}
