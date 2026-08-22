import { Check, UserRound } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { FormInput, LoadingButton } from "@/components/app-ui";
import { FieldGroup } from "@/components/ui/field";
import { getFormString, nullableString } from "@/lib/form-data";
import type { ContactProfile, ContactUpdate } from "@openengage/core/contacts";

import { Section } from "./contact-bits";

export function ContactProfileForm({
  profile,
  busy,
  onSave,
}: {
  profile: ContactProfile;
  busy: boolean;
  onSave: (input: ContactUpdate) => Promise<boolean>;
}): ReactNode {
  const contact = profile.contact;
  const disabled = contact.status === "archived";
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onSave({
      firstName: nullableString(form.get("firstName")),
      lastName: nullableString(form.get("lastName")),
      email: nullableString(form.get("email")),
      phone: nullableString(form.get("phone")),
      externalId: nullableString(form.get("externalId")),
      stage: getFormString(form, "stage"),
    });
  }
  return (
    <Section title="基本情報" icon={<UserRound className="size-4" />}>
      <form onSubmit={submit}>
        <FieldGroup>
          <FieldGroup className="grid grid-cols-2 gap-3">
            <FormInput
              label="名"
              name="firstName"
              defaultValue={contact.firstName ?? ""}
              disabled={disabled}
            />
            <FormInput
              label="姓"
              name="lastName"
              defaultValue={contact.lastName ?? ""}
              disabled={disabled}
            />
          </FieldGroup>
          <FormInput
            label="メール"
            name="email"
            type="email"
            defaultValue={contact.email ?? ""}
            disabled={disabled}
          />
          <FieldGroup className="grid grid-cols-2 gap-3">
            <FormInput
              label="電話番号"
              name="phone"
              defaultValue={contact.phone ?? ""}
              disabled={disabled}
            />
            <FormInput
              label="外部ID"
              name="externalId"
              defaultValue={contact.externalId ?? ""}
              disabled={disabled}
            />
          </FieldGroup>
          <FormInput
            label="ステージ"
            name="stage"
            defaultValue={contact.stage}
            disabled={disabled}
            required
          />
          {!disabled ? (
            <LoadingButton busy={busy} variant="outline" type="submit">
              <Check data-icon="inline-start" />
              基本情報を保存
            </LoadingButton>
          ) : null}
        </FieldGroup>
      </form>
    </Section>
  );
}
