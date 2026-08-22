import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode } from "react";

import { FormInput, FormNativeSelect } from "@/components/app-ui";
import { FormDialog } from "@/components/app-ui/dialogs";
import { FieldGroup } from "@/components/ui/field";
import { NativeSelectOption } from "@/components/ui/native-select";
import { useCreateContact, type ContactOptions } from "@/features/contacts/contact-api";
import { createDynamicSegment, invalidateSegmentsList } from "@/features/segments/segment-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString, optionalString } from "@/lib/form-data";
import { type SegmentFilter } from "@openengage/core/segments";

export function ContactCreateForm({
  open,
  onOpenChange,
  options,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ContactOptions;
  onSaved: () => Promise<void>;
}): ReactNode {
  const createContact = useCreateContact();
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const tagId = optionalString(form.get("tagId"));
      const segmentId = optionalString(form.get("segmentId"));
      const companyId = optionalString(form.get("companyId"));
      await createContact.mutateAsync({
        email: optionalString(form.get("email")),
        firstName: optionalString(form.get("firstName")),
        lastName: optionalString(form.get("lastName")),
        phone: optionalString(form.get("phone")),
        externalId: optionalString(form.get("externalId")),
        stage: optionalString(form.get("stage")) ?? "lead",
        customFields: {},
        ...(tagId ? { tagId } : {}),
        ...(segmentId ? { segmentId } : {}),
        ...(companyId ? { companyId } : {}),
      });
      await onSaved();
    });
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="連絡先を追加"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="保存"
      className="sm:max-w-2xl"
    >
      <FieldGroup className="max-h-[75vh] overflow-y-auto pr-1">
        <FieldGroup className="grid grid-cols-2 gap-3">
          <FormInput label="名" name="firstName" />
          <FormInput label="姓" name="lastName" />
        </FieldGroup>
        <FormInput label="メールアドレス" name="email" type="email" />
        <FieldGroup className="grid grid-cols-2 gap-3">
          <FormInput label="電話番号" name="phone" />
          <FormInput label="外部ID" name="externalId" />
        </FieldGroup>
        <FieldGroup className="grid gap-3 md:grid-cols-2">
          <FormInput label="ステージ" name="stage" defaultValue="lead" />
          <FormNativeSelect label="会社" name="companyId">
            <NativeSelectOption value="">指定なし</NativeSelectOption>
            {options.companies.map((company) => (
              <NativeSelectOption key={company.id} value={company.id}>
                {company.name}
              </NativeSelectOption>
            ))}
          </FormNativeSelect>
          <FormNativeSelect label="タグ" name="tagId">
            <NativeSelectOption value="">指定なし</NativeSelectOption>
            {options.tags.map((tag) => (
              <NativeSelectOption key={tag.id} value={tag.id}>
                {tag.name}
              </NativeSelectOption>
            ))}
          </FormNativeSelect>
          <FormNativeSelect label="リスト" name="segmentId">
            <NativeSelectOption value="">指定なし</NativeSelectOption>
            {options.segments
              .filter((segment) => segment.kind === "static")
              .map((segment) => (
                <NativeSelectOption key={segment.id} value={segment.id}>
                  {segment.name}
                </NativeSelectOption>
              ))}
          </FormNativeSelect>
        </FieldGroup>
        <p className="text-xs text-muted-foreground">
          メールアドレスまたは外部IDのどちらかを入力してください。
        </p>
      </FieldGroup>
    </FormDialog>
  );
}

export function SegmentSaveForm({
  open,
  onOpenChange,
  filter,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter: SegmentFilter | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("セグメントを保存できませんでした");
  const queryClient = useQueryClient();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!filter) return;
    const name = getFormString(new FormData(event.currentTarget), "name");
    await run(async () => {
      await createDynamicSegment({
        name,
        filter,
      });
      await invalidateSegmentsList(queryClient);
      await onSaved();
    });
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="検索条件をセグメントとして保存"
      description="現在の検索条件を動的セグメントに変換します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="保存"
    >
      <FormInput label="セグメント名" name="name" required />
      <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        現在の検索条件を動的セグメントとして保存します。連絡先の状態が変わったら再評価できます。
      </p>
    </FormDialog>
  );
}
