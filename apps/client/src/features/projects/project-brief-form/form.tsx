import type { Dispatch, ReactNode, SetStateAction } from "react";

import { FormInput, FormNativeSelect, FormSelectOption, FormTextarea } from "@/components/app-ui";
import { FieldGroup } from "@/components/ui/field";
import type {
  MarketingAutomationBriefDefinition,
  ProjectMemberOption,
} from "@openengage/core/projects";

import { DecisionSection } from "./decision-section";
import { errorAt, type ProjectBriefFieldErrors, type ProjectBriefFormDraft } from "./draft";
import { FlowSection, DeliverySection } from "./flow-delivery-sections";
import { MeasurementSection } from "./measurement-section";
import { NextStepsSection } from "./next-steps-section";

const EMPTY_ERRORS: ProjectBriefFieldErrors = {};

export function ProjectBriefForm({
  value,
  members,
  disabled = false,
  errors = EMPTY_ERRORS,
  onChange,
}: {
  value: ProjectBriefFormDraft;
  members: ProjectMemberOption[];
  disabled?: boolean;
  errors?: ProjectBriefFieldErrors;
  onChange: Dispatch<SetStateAction<ProjectBriefFormDraft>>;
}): ReactNode {
  const definition = value.definition;
  const updateDefinition = (patch: Partial<MarketingAutomationBriefDefinition>) =>
    onChange((current) => ({
      ...current,
      definition: { ...current.definition, ...patch },
    }));
  const sectionProps = { definition, disabled, errors, updateDefinition };
  return (
    <FieldGroup className="gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <FormInput
          name="name"
          label="施策名"
          value={value.name}
          disabled={disabled}
          error={errorAt(errors, "name")}
          maxLength={191}
          onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
        />
        <FormNativeSelect
          name="primaryMotion"
          label="主要モーション"
          value={value.primaryMotion}
          disabled={disabled}
          error={errorAt(errors, "primaryMotion")}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              primaryMotion: event.target.value as ProjectBriefFormDraft["primaryMotion"],
            }))
          }
        >
          {[
            ["acquisition", "獲得"],
            ["onboarding", "オンボーディング"],
            ["engagement", "エンゲージメント"],
            ["retention", "継続"],
            ["reactivation", "再活性化"],
            ["measurement", "計測"],
          ].map(([id, label]) => (
            <FormSelectOption key={id} value={id}>
              {label}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </div>
      <FormTextarea
        name="description"
        label="概要"
        value={value.description}
        disabled={disabled}
        error={errorAt(errors, "description")}
        rows={2}
        onChange={(event) =>
          onChange((current) => ({ ...current, description: event.target.value }))
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <MemberSelect
          name="ownerUserId"
          label="担当者"
          value={value.ownerUserId}
          members={members}
          disabled={disabled}
          error={errorAt(errors, "ownerUserId")}
          onChange={(ownerUserId) => onChange((current) => ({ ...current, ownerUserId }))}
        />
        <MemberSelect
          name="approverUserId"
          label="承認者"
          value={value.approverUserId}
          members={members}
          disabled={disabled}
          error={errorAt(errors, "approverUserId")}
          onChange={(approverUserId) => onChange((current) => ({ ...current, approverUserId }))}
        />
      </div>
      <FormInput
        name="reviewAt"
        label="レビュー日時"
        type="datetime-local"
        value={value.reviewAt}
        disabled={disabled}
        error={errorAt(errors, "reviewAt")}
        onChange={(event) => onChange((current) => ({ ...current, reviewAt: event.target.value }))}
      />
      <DecisionSection {...sectionProps} />
      <FlowSection {...sectionProps} />
      <DeliverySection {...sectionProps} />
      <MeasurementSection {...sectionProps} />
      <NextStepsSection {...sectionProps} />
    </FieldGroup>
  );
}

function MemberSelect({
  name,
  label,
  value,
  members,
  disabled,
  error,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  members: ProjectMemberOption[];
  disabled: boolean;
  error?: string | undefined;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <FormNativeSelect
      name={name}
      label={label}
      value={value}
      disabled={disabled}
      error={error}
      onChange={(event) => onChange(event.target.value)}
    >
      <FormSelectOption value="">選択してください</FormSelectOption>
      {members.map((member) => (
        <FormSelectOption key={member.id} value={member.id}>
          {member.name} · {member.role}
        </FormSelectOption>
      ))}
    </FormNativeSelect>
  );
}
