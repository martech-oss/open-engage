import { Plus, Trash2 } from "lucide-react";
import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { FORM_FIELD_INPUT_TYPES, type FormField } from "@openengage/core/web";

const TYPE_LABELS: Record<(typeof FORM_FIELD_INPUT_TYPES)[number], string> = {
  email: "メール",
  text: "テキスト",
  tel: "電話番号",
  url: "URL",
  number: "数値",
  date: "日付",
  textarea: "複数行テキスト",
  select: "選択肢",
};

/**
 * Custom fields land in `contacts.custom_fields` under their key, so the key
 * doubles as the merge-tag name (`{{contact.job_title}}`) and as the segment
 * `custom_field` key - renaming one later orphans the values already stored.
 */
export function FormFieldBuilder({
  fields,
  onChange,
}: {
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
}): ReactNode {
  function update(index: number, changes: Partial<FormField>): void {
    onChange(
      fields.map((field, position) => (position === index ? { ...field, ...changes } : field)),
    );
  }

  function add(): void {
    onChange([
      ...fields,
      {
        key: "",
        kind: "custom",
        label: "",
        type: "text",
        required: false,
        progressive: false,
      },
    ]);
  }

  return (
    <Field>
      <FieldLabel>カスタム項目</FieldLabel>
      <FieldDescription>
        連絡先のカスタムフィールドとして保存します。キーはセグメント条件やメール差し込みでも使います。
      </FieldDescription>
      <div className="flex flex-col gap-3">
        {fields.map((field, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Input
                aria-label={`カスタム項目${index + 1}のキー`}
                value={field.key}
                onChange={(event) => update(index, { key: event.currentTarget.value })}
                placeholder="job_title"
                pattern="[A-Za-z0-9_-]+"
              />
              <Input
                aria-label={`カスタム項目${index + 1}のラベル`}
                value={field.label ?? ""}
                onChange={(event) => update(index, { label: event.currentTarget.value })}
                placeholder="役職"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`カスタム項目${index + 1}を削除`}
                onClick={() => onChange(fields.filter((_, position) => position !== index))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <NativeSelect
                aria-label={`カスタム項目${index + 1}の種類`}
                value={field.type}
                onChange={(event) =>
                  update(index, { type: event.currentTarget.value as FormField["type"] })
                }
              >
                {FORM_FIELD_INPUT_TYPES.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <label
                className="flex items-center gap-2 text-sm"
                htmlFor={`field-required-${index}`}
              >
                <Checkbox
                  id={`field-required-${index}`}
                  checked={field.required}
                  onCheckedChange={(checked) => update(index, { required: checked === true })}
                />
                必須
              </label>
              <label
                className="flex items-center gap-2 text-sm"
                htmlFor={`field-progressive-${index}`}
              >
                <Checkbox
                  id={`field-progressive-${index}`}
                  checked={field.progressive}
                  onCheckedChange={(checked) => update(index, { progressive: checked === true })}
                />
                段階的に質問
              </label>
            </div>
            {field.type === "select" ? (
              <Input
                aria-label={`カスタム項目${index + 1}の選択肢`}
                value={(field.options ?? []).join(", ")}
                onChange={(event) =>
                  update(index, {
                    options: event.currentTarget.value
                      .split(",")
                      .map((option) => option.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="1〜10名, 11〜50名, 51名以上"
              />
            ) : null}
            {(["visibleWhen", "requiredWhen"] as const).map((kind) => (
              <div key={kind} className="grid gap-2 sm:grid-cols-3">
                <NativeSelect
                  aria-label={`${field.label || field.key}の${kind === "visibleWhen" ? "表示条件" : "必須条件"}`}
                  value={field[kind]?.field ?? ""}
                  onChange={(event) =>
                    update(index, {
                      [kind]: event.currentTarget.value
                        ? { field: event.currentTarget.value, operator: "not_empty" }
                        : undefined,
                    })
                  }
                >
                  <NativeSelectOption value="">
                    {kind === "visibleWhen" ? "常に表示" : "必須条件なし"}
                  </NativeSelectOption>
                  {[
                    "email",
                    ...fields
                      .filter((candidate) => candidate.key !== field.key)
                      .map((candidate) => candidate.key),
                  ]
                    .filter(Boolean)
                    .map((key) => (
                      <NativeSelectOption key={key} value={key}>
                        {key}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                {field[kind] && (
                  <>
                    <NativeSelect
                      aria-label={`${field.label || field.key}の条件演算子`}
                      value={field[kind].operator}
                      onChange={(event) =>
                        update(index, {
                          [kind]: {
                            ...field[kind],
                            operator: event.currentTarget.value,
                            ...(["equals", "not_equals"].includes(event.currentTarget.value)
                              ? { value: field[kind]?.value ?? "" }
                              : {}),
                          },
                        })
                      }
                    >
                      <NativeSelectOption value="not_empty">入力あり</NativeSelectOption>
                      <NativeSelectOption value="empty">未入力</NativeSelectOption>
                      <NativeSelectOption value="equals">等しい</NativeSelectOption>
                      <NativeSelectOption value="not_equals">等しくない</NativeSelectOption>
                    </NativeSelect>
                    {["equals", "not_equals"].includes(field[kind].operator) && (
                      <Input
                        aria-label={`${field.label || field.key}の条件値`}
                        value={field[kind].value ?? ""}
                        onChange={(event) =>
                          update(index, {
                            [kind]: { ...field[kind], value: event.currentTarget.value },
                          })
                        }
                      />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus data-icon="inline-start" />
          カスタム項目を追加
        </Button>
      </div>
    </Field>
  );
}
