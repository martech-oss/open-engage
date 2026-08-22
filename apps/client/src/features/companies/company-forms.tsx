import { Sparkles } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

import {
  AppDialog,
  EmptyState,
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
} from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import type { ContactOption } from "@/features/companies/company-api";
import { contactOptionLabel } from "@/features/contacts/contact-bits";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";

import { CompanyEnrichmentSheet } from "./company-enrichment-sheet";

export function CompanyForm({
  open,
  onOpenChange,
  title,
  description,
  initialName = "",
  initialDomain = "",
  enrichmentEnabled = false,
  submitLabel,
  onSubmit,
}: CompanyFormProps): ReactNode {
  return (
    <CompanyFormContent
      key={open ? `${initialName}:${initialDomain}` : "closed"}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      initialName={initialName}
      initialDomain={initialDomain}
      enrichmentEnabled={enrichmentEnabled}
      submitLabel={submitLabel}
      onSubmit={onSubmit}
    />
  );
}

interface CompanyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initialName?: string;
  initialDomain?: string;
  enrichmentEnabled?: boolean;
  submitLabel: string;
  onSubmit: (values: { name: string; domain?: string }) => Promise<void>;
}

function CompanyFormContent({
  open,
  onOpenChange,
  title,
  description,
  initialName = "",
  initialDomain = "",
  enrichmentEnabled = false,
  submitLabel,
  onSubmit,
}: CompanyFormProps): ReactNode {
  const { busy, error, run } = useFormSubmission("会社を保存できませんでした");
  const [name, setName] = useState(initialName);
  const [domain, setDomain] = useState(initialDomain);
  const [showEnrichment, setShowEnrichment] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const domain = getFormString(form, "domain").trim().toLowerCase();
    await run(async () => {
      await onSubmit({
        name: getFormString(form, "name").trim(),
        ...(domain ? { domain } : {}),
      });
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={submitLabel}
    >
      <FormInput
        label="会社名"
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="例：Acme株式会社"
        required
      />
      <FormInput
        label="ドメイン"
        name="domain"
        value={domain}
        onChange={(event) => setDomain(event.target.value)}
        placeholder="例：acme.co.jp"
        description="URLではなくメールドメインを入力してください。"
        pattern="(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}"
      />
      {enrichmentEnabled ? (
        <Button
          type="button"
          variant="outline"
          disabled={!name.trim() && !isCompanyDomain(domain)}
          onClick={() => setShowEnrichment(true)}
        >
          <Sparkles data-icon="inline-start" />
          会社情報を取得
        </Button>
      ) : null}
      <CompanyEnrichmentSheet
        open={showEnrichment}
        onOpenChange={setShowEnrichment}
        source={
          isCompanyDomain(domain)
            ? { source: "domain", domain: domain.trim().toLowerCase() }
            : { source: "name", name: name.trim() || initialName || "会社" }
        }
        currentName={name.trim()}
        currentDomain={domain.trim().toLowerCase()}
        onApply={async (values) => {
          if (values.name) setName(values.name);
          if (values.domain) setDomain(values.domain);
        }}
      />
    </FormDialog>
  );
}

function isCompanyDomain(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value.trim());
}

export function AddCompanyContactForm({
  open,
  onOpenChange,
  title,
  description,
  contacts,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  contacts: ContactOption[];
  onSubmit: (values: { contactId: string; title?: string; isPrimary: boolean }) => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("連絡先を追加できませんでした");
  const [isPrimary, setIsPrimary] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const titleValue = getFormString(form, "title").trim();
    await run(async () => {
      await onSubmit({
        contactId: getFormString(form, "contactId"),
        ...(titleValue ? { title: titleValue } : {}),
        isPrimary,
      });
    });
  }

  if (contacts.length === 0) {
    return (
      <AppDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
        <EmptyState
          compact
          title="追加できる連絡先がありません"
          description="すべての連絡先がこの会社に所属しています。"
        />
      </AppDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="追加"
    >
      <FormNativeSelect label="連絡先" name="contactId" required>
        <FormSelectOption value="">選択してください</FormSelectOption>
        {contacts.map((contact) => (
          <FormSelectOption key={contact.id} value={contact.id}>
            {contactOptionLabel(contact)}
          </FormSelectOption>
        ))}
      </FormNativeSelect>
      <FormInput label="役職" name="title" placeholder="例：マーケティング責任者" />
      <Field orientation="horizontal">
        <Checkbox
          id="company-primary-contact"
          checked={isPrimary}
          onCheckedChange={(checked) => setIsPrimary(Boolean(checked))}
        />
        <FieldContent>
          <FieldLabel htmlFor="company-primary-contact">
            <FieldTitle>主担当にする</FieldTitle>
            <FieldDescription>この連絡先に設定済みの主担当は解除されます。</FieldDescription>
          </FieldLabel>
        </FieldContent>
      </Field>
    </FormDialog>
  );
}
