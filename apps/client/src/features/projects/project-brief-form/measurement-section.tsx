import type { ReactNode } from "react";

import { FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";

import { errorAt } from "./draft";
import { Section, TextField, type BriefSectionProps } from "./shared";

export function MeasurementSection(props: BriefSectionProps): ReactNode {
  const { definition, disabled, errors, updateDefinition } = props;
  const measurement = definition.measurement;
  const baseline = measurement.baseline;
  const updateMeasurement = (patch: Partial<typeof measurement>) =>
    updateDefinition({ measurement: { ...measurement, ...patch } });
  return (
    <Section title="Measurement">
      <TextField
        name="definition.measurement.outcomeMetric.name"
        label="成果指標"
        value={measurement.outcomeMetric.name}
        disabled={disabled}
        error={errorAt(errors, "definition.measurement.outcomeMetric.name")}
        onChange={(name) =>
          updateMeasurement({ outcomeMetric: { ...measurement.outcomeMetric, name } })
        }
      />
      <TextField
        name="definition.measurement.outcomeMetric.proof"
        label="成果を証明するイベント／フィールド"
        value={measurement.outcomeMetric.proof}
        disabled={disabled}
        error={errorAt(errors, "definition.measurement.outcomeMetric.proof")}
        onChange={(proof) =>
          updateMeasurement({ outcomeMetric: { ...measurement.outcomeMetric, proof } })
        }
      />
      <TextField
        name="definition.measurement.earlySignal.name"
        label="早期シグナル"
        value={measurement.earlySignal.name}
        disabled={disabled}
        error={errorAt(errors, "definition.measurement.earlySignal.name")}
        onChange={(name) =>
          updateMeasurement({ earlySignal: { ...measurement.earlySignal, name } })
        }
      />
      <TextField
        name="definition.measurement.earlySignal.proof"
        label="早期シグナルを証明するイベント／フィールド"
        value={measurement.earlySignal.proof}
        disabled={disabled}
        error={errorAt(errors, "definition.measurement.earlySignal.proof")}
        onChange={(proof) =>
          updateMeasurement({ earlySignal: { ...measurement.earlySignal, proof } })
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <FormNativeSelect
          name="definition.measurement.baseline.kind"
          label="ベースライン種別"
          value={baseline.kind}
          disabled={disabled}
          error={errorAt(errors, "definition.measurement.baseline.kind")}
          onChange={(event) => {
            const kind = event.target.value;
            if (kind === "unknown") updateMeasurement({ baseline: { kind, discoveryTask: "" } });
            else if (kind === "assumption") {
              updateMeasurement({ baseline: { kind, value: "", evidenceThatWouldChange: "" } });
            } else updateMeasurement({ baseline: { kind: "measured", value: "", source: "" } });
          }}
        >
          <FormSelectOption value="unknown">未計測</FormSelectOption>
          <FormSelectOption value="assumption">仮定</FormSelectOption>
          <FormSelectOption value="measured">計測済み</FormSelectOption>
        </FormNativeSelect>
        {baseline.kind === "unknown" ? (
          <FormInput
            name="definition.measurement.baseline.discoveryTask"
            label="確認タスク"
            value={baseline.discoveryTask}
            disabled={disabled}
            error={errorAt(errors, "definition.measurement.baseline.discoveryTask")}
            onChange={(event) =>
              updateMeasurement({ baseline: { ...baseline, discoveryTask: event.target.value } })
            }
          />
        ) : (
          <>
            <FormInput
              name="definition.measurement.baseline.value"
              label="ベースライン値"
              value={baseline.value}
              disabled={disabled}
              error={errorAt(errors, "definition.measurement.baseline.value")}
              onChange={(event) =>
                updateMeasurement({ baseline: { ...baseline, value: event.target.value } })
              }
            />
            <FormInput
              name="definition.measurement.baseline.evidence"
              label={baseline.kind === "measured" ? "情報源" : "仮定を覆す証拠"}
              value={
                baseline.kind === "measured" ? baseline.source : baseline.evidenceThatWouldChange
              }
              disabled={disabled}
              error={errorAt(
                errors,
                baseline.kind === "measured"
                  ? "definition.measurement.baseline.source"
                  : "definition.measurement.baseline.evidenceThatWouldChange",
              )}
              onChange={(event) =>
                updateMeasurement({
                  baseline:
                    baseline.kind === "measured"
                      ? { ...baseline, source: event.target.value }
                      : { ...baseline, evidenceThatWouldChange: event.target.value },
                })
              }
            />
          </>
        )}
      </div>
      <TextField
        name="definition.measurement.successThreshold"
        label="成功基準"
        value={measurement.successThreshold}
        disabled={disabled}
        error={errorAt(errors, "definition.measurement.successThreshold")}
        onChange={(successThreshold) => updateMeasurement({ successThreshold })}
      />
    </Section>
  );
}
