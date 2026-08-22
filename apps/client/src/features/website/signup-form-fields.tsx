import type { ReactNode } from "react";

import { FormInput, FormNativeSelect, FormSelectOption, FormTextarea } from "@/components/app-ui";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { FormField } from "@openengage/core/web";

import { FormFieldBuilder } from "./form-field-builder";
import type { SignupFormRow } from "./website-api";

const OPTIONAL_FIELDS = [
  ["firstName", "名"],
  ["lastName", "姓"],
  ["phone", "電話番号"],
] as const;

export type OptionalSignupField = (typeof OPTIONAL_FIELDS)[number][0];

export function SignupFormFields({
  item,
  optionalFields,
  onToggleField,
  customFields,
  onCustomFieldsChange,
  turnstileEnabled,
  onTurnstileEnabledChange,
}: {
  item: SignupFormRow | null;
  optionalFields: ReadonlySet<OptionalSignupField>;
  onToggleField: (field: OptionalSignupField, checked: boolean) => void;
  customFields: FormField[];
  onCustomFieldsChange: (fields: FormField[]) => void;
  turnstileEnabled: boolean;
  onTurnstileEnabledChange: (enabled: boolean) => void;
}): ReactNode {
  return (
    <>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="名前"
          name="name"
          defaultValue={item?.name}
          placeholder="ニュースレター登録"
          required
        />
        <FormInput
          label="スラッグ"
          name="slug"
          defaultValue={item?.slug}
          description="未入力なら名前から自動生成します。"
          placeholder="newsletter"
        />
        <FormNativeSelect
          label="フォーム形式"
          name="style"
          defaultValue={item?.definition.style ?? "inline"}
        >
          <FormSelectOption value="inline">インライン</FormSelectOption>
          <FormSelectOption value="floating-bar">フローティングバー</FormSelectOption>
          <FormSelectOption value="floating-box">フローティングボックス</FormSelectOption>
          <FormSelectOption value="modal">モーダル</FormSelectOption>
        </FormNativeSelect>
        <FormNativeSelect label="公開状態" name="status" defaultValue={item?.status ?? "draft"}>
          <FormSelectOption value="draft">下書き</FormSelectOption>
          <FormSelectOption value="published">公開</FormSelectOption>
        </FormNativeSelect>
      </FieldGroup>
      <FieldSet>
        <FieldLegend variant="label">取得する項目</FieldLegend>
        <FieldDescription>
          メールアドレスは必須です。連絡先の標準カラムに保存されます。
        </FieldDescription>
        <FieldGroup className="gap-3 sm:grid sm:grid-cols-2">
          <Field orientation="horizontal" data-disabled>
            <Checkbox id="field-email" checked disabled />
            <FieldLabel htmlFor="field-email">メールアドレス（必須）</FieldLabel>
          </Field>
          {OPTIONAL_FIELDS.map(([key, label]) => (
            <Field key={key} orientation="horizontal">
              <Checkbox
                id={`field-${key}`}
                checked={optionalFields.has(key)}
                onCheckedChange={(checked) => onToggleField(key, Boolean(checked))}
              />
              <FieldLabel htmlFor={`field-${key}`}>{label}</FieldLabel>
            </Field>
          ))}
        </FieldGroup>
      </FieldSet>
      <FormFieldBuilder fields={customFields} onChange={onCustomFieldsChange} />
      <FormInput
        label="1回に質問する段階的項目の上限"
        name="progressiveMaxFields"
        type="number"
        min={1}
        max={10}
        defaultValue={item?.definition.progressiveMaxFields ?? 3}
        description="「段階的に質問」を付けた項目のうち、未回答のものをこの件数まで表示します。"
      />
      <FormTextarea
        label="許可ドメイン"
        name="allowedDomains"
        defaultValue={item?.allowedDomains.join("\n")}
        description="1行に1ドメイン。空欄ならすべてのドメインから送信できます。"
        placeholder={"example.com\ncampaign.example.com"}
        rows={3}
      />
      <FormInput
        label="送信完了メッセージ"
        name="successMessage"
        defaultValue={item?.successMessage ?? "ありがとうございます。"}
        required
      />
      <Field orientation="horizontal">
        <Switch
          id="form-turnstile"
          checked={turnstileEnabled}
          onCheckedChange={onTurnstileEnabledChange}
        />
        <FieldContent>
          <FieldLabel htmlFor="form-turnstile">
            <FieldTitle>Turnstileによるbot対策</FieldTitle>
            <FieldDescription>
              WorkerにTurnstileシークレットが設定されている場合に検証します。
            </FieldDescription>
          </FieldLabel>
        </FieldContent>
      </Field>
    </>
  );
}
