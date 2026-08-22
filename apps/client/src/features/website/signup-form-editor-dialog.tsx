import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { FormDialog } from "@/components/app-ui/dialogs";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import type { FormField } from "@openengage/core/web";

import { SignupFormFields, type OptionalSignupField } from "./signup-form-fields";
import {
  type SignupFormDefinition,
  type SignupFormRow,
  useCreateSignupForm,
  useUpdateSignupForm,
} from "./website-api";

const OPTIONAL_FIELD_KEYS: OptionalSignupField[] = ["firstName", "lastName", "phone"];

export function SignupFormEditorDialog({
  item,
  open,
  onOpenChange,
  onSaved,
  createMutation,
  updateMutation,
}: {
  item: SignupFormRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  createMutation: Pick<ReturnType<typeof useCreateSignupForm>, "mutateAsync">;
  updateMutation: Pick<ReturnType<typeof useUpdateSignupForm>, "mutateAsync">;
}): ReactNode {
  const initialKeys = new Set(item?.definition.fields?.map((field) => field.key) ?? []);
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  const [turnstileEnabled, setTurnstileEnabled] = useState(item?.turnstileEnabled ?? true);
  const [optionalFields, setOptionalFields] = useState(
    () => new Set(OPTIONAL_FIELD_KEYS.filter((key) => initialKeys.has(key))),
  );
  const [customFields, setCustomFields] = useState<FormField[]>(
    () => item?.definition.fields?.filter((field) => field.kind === "custom") ?? [],
  );

  function toggleField(field: OptionalSignupField, checked: boolean): void {
    setOptionalFields((current) => {
      const next = new Set(current);
      if (checked) next.add(field);
      else next.delete(field);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = getFormString(formData, "name").trim();
    const slug = getFormString(formData, "slug").trim();
    const standard = (key: FormField["key"], type: FormField["type"]): FormField => ({
      key,
      kind: "standard",
      type,
      required: key === "email",
      progressive: false,
    });
    const fields: FormField[] = [standard("email", "email")];
    if (optionalFields.has("firstName")) fields.push(standard("firstName", "text"));
    if (optionalFields.has("lastName")) fields.push(standard("lastName", "text"));
    if (optionalFields.has("phone")) fields.push(standard("phone", "tel"));
    fields.push(...customFields.filter((field) => field.key.trim().length > 0));
    const allowedDomains = getFormString(formData, "allowedDomains")
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const payload = {
      name,
      status: getFormString(formData, "status") === "published" ? "published" : "draft",
      definition: {
        style: readFormStyle(formData),
        fields,
        progressiveMaxFields: Number(getFormString(formData, "progressiveMaxFields")) || 3,
      },
      allowedDomains,
      turnstileEnabled,
      successMessage: getFormString(formData, "successMessage"),
    } as const;
    await run(async () => {
      if (item) {
        await updateMutation.mutateAsync({ id: item.id, ...payload, slug: slug || item.slug });
        toast.success("フォームを更新しました");
      } else {
        await createMutation.mutateAsync({ ...payload, ...(slug ? { slug } : {}) });
        toast.success("フォームを作成しました");
      }
      onSaved();
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "フォームを編集" : "フォームを作成"}
      description="メールアドレスはすべてのフォームで必須です。"
      className="sm:max-w-2xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "フォームを作成"}
    >
      <SignupFormFields
        item={item}
        optionalFields={optionalFields}
        onToggleField={toggleField}
        customFields={customFields}
        onCustomFieldsChange={setCustomFields}
        turnstileEnabled={turnstileEnabled}
        onTurnstileEnabledChange={setTurnstileEnabled}
      />
    </FormDialog>
  );
}

function readFormStyle(formData: FormData): NonNullable<SignupFormDefinition["style"]> {
  const value = getFormString(formData, "style");
  return value === "floating-bar" || value === "floating-box" || value === "modal"
    ? value
    : "inline";
}
