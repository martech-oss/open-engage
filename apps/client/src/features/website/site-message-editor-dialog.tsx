import { type FormEvent, type ReactNode } from "react";

import { FormInput, FormNativeSelect, FormSelectOption, FormTextarea } from "@/components/app-ui";
import { FormDialog } from "@/components/app-ui/dialogs";
import { FieldGroup } from "@/components/ui/field";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { SiteMessageScheduleFields } from "./site-message-schedule-fields";
import { type SiteMessageRow, useCreateSiteMessage, useUpdateSiteMessage } from "./website-api";

export function SiteMessageEditorDialog({
  item,
  open,
  onOpenChange,
  onSaved,
  createMutation,
  updateMutation,
}: {
  item: SiteMessageRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  createMutation: Pick<ReturnType<typeof useCreateSiteMessage>, "mutateAsync">;
  updateMutation: Pick<ReturnType<typeof useUpdateSiteMessage>, "mutateAsync">;
}): ReactNode {
  const { toDateTimeLocal } = useWorkspaceFormatters();
  const { busy, error, run, setError } = useFormSubmission("保存できませんでした");
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const ctaUrl = getFormString(formData, "ctaUrl").trim();
    const startsAt = dateTimeValue(formData.get("startsAt"));
    const endsAt = dateTimeValue(formData.get("endsAt"));
    if (startsAt && endsAt && startsAt >= endsAt) {
      setError("終了日時は開始日時より後にしてください");
      return;
    }
    const payload = {
      name: getFormString(formData, "name"),
      status: getFormString(formData, "status") === "published" ? "published" : "draft",
      headline: getFormString(formData, "headline"),
      body: getFormString(formData, "body"),
      ctaLabel: getFormString(formData, "ctaLabel"),
      ctaUrl: ctaUrl || null,
      pagePattern: getFormString(formData, "pagePattern"),
      startsAt,
      endsAt,
    } as const;
    await run(() =>
      saveResource({
        editing: item,
        payload,
        create: (data) => createMutation.mutateAsync(data),
        update: (id, data) => updateMutation.mutateAsync({ id, ...data }),
        createdMessage: "サイトメッセージを作成しました",
        updatedMessage: "サイトメッセージを更新しました",
        onSaved,
      }),
    );
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "サイトメッセージを編集" : "サイトメッセージを作成"}
      description="サイト右下に表示する内容と対象ページを設定します。"
      className="sm:max-w-2xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "メッセージを作成"}
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="管理用の名前"
          name="name"
          defaultValue={item?.name}
          placeholder="料金ページの案内"
          required
        />
        <FormNativeSelect label="公開状態" name="status" defaultValue={item?.status ?? "draft"}>
          <FormSelectOption value="draft">下書き</FormSelectOption>
          <FormSelectOption value="published">公開</FormSelectOption>
        </FormNativeSelect>
      </FieldGroup>
      <FormInput
        label="見出し"
        name="headline"
        defaultValue={item?.headline}
        placeholder="ご不明な点はありませんか？"
        required
      />
      <FormTextarea label="本文" name="body" defaultValue={item?.body} rows={3} />
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="CTAラベル"
          name="ctaLabel"
          defaultValue={item?.ctaLabel ?? ""}
          placeholder="相談する"
        />
        <FormInput
          label="CTAリンク"
          name="ctaUrl"
          type="url"
          defaultValue={item?.ctaUrl ?? ""}
          placeholder="https://example.com/contact"
        />
      </FieldGroup>
      <FormInput
        label="対象ページ"
        name="pagePattern"
        defaultValue={item?.pagePattern ?? "*"}
        description="* はすべてのページ、/pricing* は料金ページ配下を表します。"
        placeholder="/pricing*"
        required
      />
      <SiteMessageScheduleFields
        startsAt={toDateTimeLocal(item?.startsAt)}
        endsAt={toDateTimeLocal(item?.endsAt)}
      />
    </FormDialog>
  );
}

function dateTimeValue(value: FormDataEntryValue | null): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? new Date(raw).toISOString() : null;
}
