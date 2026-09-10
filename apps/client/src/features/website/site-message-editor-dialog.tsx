import { type FormEvent, type ReactNode } from "react";

import { FormInput, FormNativeSelect, FormSelectOption, FormTextarea } from "@/components/app-ui";
import { FormDialog } from "@/components/app-ui/dialogs";
import { FieldGroup } from "@/components/ui/field";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";
import { useWorkspaceFormatters, useWorkspaceTime } from "@/lib/workspace-time";
import { WorkspaceDateTimeError } from "@openengage/core/shared/time";
import type { SiteMessageWrite } from "@openengage/core/web";

import { normalizeSiteMessageSchedule } from "./site-message-schedule";
import { SiteMessageScheduleFields } from "./site-message-schedule-fields";
import {
  type SiteMessageRow,
  type useCreateSiteMessage,
  type useUpdateSiteMessage,
} from "./website-api";

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
  const { timeZone } = useWorkspaceTime();
  const { busy, error, run, setError } = useFormSubmission("保存できませんでした");
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    let schedule;
    try {
      schedule = siteMessagePayload(formData, timeZone);
    } catch (cause) {
      setError(
        cause instanceof WorkspaceDateTimeError
          ? "ワークスペースのタイムゾーンに存在する日時を入力してください"
          : cause instanceof Error
            ? cause.message
            : "日時を確認してください",
      );
      return;
    }
    await run(() =>
      saveResource({
        editing: item,
        payload: schedule,
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
      <SiteMessageDeliveryFields item={item} />
      <SiteMessageScheduleFields
        startsAt={toDateTimeLocal(item?.startsAt)}
        endsAt={toDateTimeLocal(item?.endsAt)}
      />
    </FormDialog>
  );
}

function SiteMessageDeliveryFields({ item }: { item: SiteMessageRow | null }): ReactNode {
  return (
    <>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormNativeSelect
          label="対象の訪問者"
          name="audience"
          defaultValue={item?.audience ?? "identified"}
        >
          <FormSelectOption value="identified">識別済みの連絡先</FormSelectOption>
          <FormSelectOption value="all">すべての訪問者</FormSelectOption>
        </FormNativeSelect>
        <FormNativeSelect
          label="再表示"
          name="frequency"
          defaultValue={item?.frequency ?? "session"}
        >
          <FormSelectOption value="session">セッションに1回</FormSelectOption>
          <FormSelectOption value="page">ページごと</FormSelectOption>
        </FormNativeSelect>
      </FieldGroup>
      <p className="text-sm text-muted-foreground">
        すべての訪問者向けのメッセージは追跡同意なしでも表示します。未同意時の重複抑止はページ内のみです。
        表示数・クリック数は同意済みで識別できた連絡先のみを計測します。
      </p>
    </>
  );
}

function siteMessagePayload(formData: FormData, timeZone: string): SiteMessageWrite {
  const ctaUrl = getFormString(formData, "ctaUrl").trim();
  return {
    audience: getFormString(formData, "audience") === "all" ? "all" : "identified",
    frequency: getFormString(formData, "frequency") === "page" ? "page" : "session",
    name: getFormString(formData, "name"),
    status: getFormString(formData, "status") === "published" ? "published" : "draft",
    headline: getFormString(formData, "headline"),
    body: getFormString(formData, "body"),
    ctaLabel: getFormString(formData, "ctaLabel"),
    ctaUrl: ctaUrl || null,
    pagePattern: getFormString(formData, "pagePattern"),
    ...normalizeSiteMessageSchedule(
      {
        startsAt: dateTimeValue(formData.get("startsAt")),
        endsAt: dateTimeValue(formData.get("endsAt")),
      },
      timeZone,
    ),
  };
}

function dateTimeValue(value: FormDataEntryValue | null): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || null;
}
