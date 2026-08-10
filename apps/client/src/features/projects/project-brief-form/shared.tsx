import type { ReactNode } from "react";

import { FormTextarea } from "@/components/app-ui";
import type { MarketingAutomationBriefDefinition } from "@openengage/core/projects";

import type { ProjectBriefFieldErrors } from "./draft";

export type BriefSectionProps = {
  definition: MarketingAutomationBriefDefinition;
  disabled: boolean;
  errors: ProjectBriefFieldErrors;
  updateDefinition: (patch: Partial<MarketingAutomationBriefDefinition>) => void;
};

export function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <fieldset className="grid gap-4 rounded-lg border p-4">
      <legend className="px-2 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function TextField({
  name,
  label,
  value,
  disabled,
  error,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  disabled: boolean;
  error?: string | undefined;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <FormTextarea
      name={name}
      label={label}
      value={value}
      disabled={disabled}
      error={error}
      rows={2}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
