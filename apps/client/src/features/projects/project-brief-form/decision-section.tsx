import type { ReactNode } from "react";

import { FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import type { MarketingAutomationBriefDefinition } from "@openengage/core/projects";

import { errorAt } from "./draft";
import { Section, TextField, type BriefSectionProps } from "./shared";

export function DecisionSection({
  definition,
  disabled,
  errors,
  updateDefinition,
}: BriefSectionProps): ReactNode {
  return (
    <Section title="Decision">
      <TextField
        name="definition.outcome"
        label="Outcome"
        value={definition.outcome}
        disabled={disabled}
        error={errorAt(errors, "definition.outcome")}
        onChange={(outcome) => updateDefinition({ outcome })}
      />
      <TextField
        name="definition.audience"
        label="対象者"
        value={definition.audience}
        disabled={disabled}
        error={errorAt(errors, "definition.audience")}
        onChange={(audience) => updateDefinition({ audience })}
      />
      <TextField
        name="definition.lifecycleMoment"
        label="ライフサイクル上の瞬間"
        value={definition.lifecycleMoment}
        disabled={disabled}
        error={errorAt(errors, "definition.lifecycleMoment")}
        onChange={(lifecycleMoment) => updateDefinition({ lifecycleMoment })}
      />
      <FormNativeSelect
        name="definition.confidence"
        label="確信度"
        value={definition.confidence}
        disabled={disabled}
        error={errorAt(errors, "definition.confidence")}
        onChange={(event) =>
          updateDefinition({
            confidence: event.target.value as MarketingAutomationBriefDefinition["confidence"],
          })
        }
      >
        <FormSelectOption value="high">高</FormSelectOption>
        <FormSelectOption value="medium">中</FormSelectOption>
        <FormSelectOption value="low">低</FormSelectOption>
      </FormNativeSelect>
    </Section>
  );
}
