import type { ReactNode } from "react";

import { ArrayField } from "./array-field";
import { errorAt } from "./draft";
import { Section, TextField, type BriefSectionProps } from "./shared";

export function NextStepsSection(props: BriefSectionProps): ReactNode {
  const { definition, disabled, errors, updateDefinition } = props;
  const experiment = definition.followUpExperiment;
  return (
    <Section title="Next steps / Not included">
      <ArrayField
        name="definition.immediateNextSteps"
        label="直近のアクション（1〜3件）"
        value={definition.immediateNextSteps}
        disabled={disabled}
        errors={errors}
        minItems={1}
        maxItems={3}
        onChange={(immediateNextSteps) => updateDefinition({ immediateNextSteps })}
      />
      <ArrayField
        name="definition.notIncluded"
        label="今回は含めないもの"
        value={definition.notIncluded}
        disabled={disabled}
        errors={errors}
        onChange={(notIncluded) => updateDefinition({ notIncluded })}
      />
      <ArrayField
        name="definition.assumptions"
        label="前提"
        value={definition.assumptions}
        disabled={disabled}
        errors={errors}
        maxItems={50}
        onChange={(assumptions) => updateDefinition({ assumptions })}
      />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={experiment !== null}
          disabled={disabled}
          onChange={(event) =>
            updateDefinition({
              followUpExperiment: event.target.checked
                ? { hypothesis: "", change: "", metric: "", decisionRule: "" }
                : null,
            })
          }
        />
        フォローアップ実験を1件追加
      </label>
      {experiment ? (
        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              ["hypothesis", "仮説"],
              ["change", "変更内容"],
              ["metric", "評価指標"],
              ["decisionRule", "判断ルール"],
            ] as const
          ).map(([key, label]) => (
            <TextField
              key={key}
              name={`definition.followUpExperiment.${key}`}
              label={label}
              value={experiment[key]}
              disabled={disabled}
              error={errorAt(errors, `definition.followUpExperiment.${key}`)}
              onChange={(next) =>
                updateDefinition({ followUpExperiment: { ...experiment, [key]: next } })
              }
            />
          ))}
        </div>
      ) : null}
    </Section>
  );
}
