import type { ReactNode } from "react";

import { FormInput, FormNativeSelect, FormSelectOption, FormTextarea } from "@/components/app-ui";
import { FieldGroup } from "@/components/ui/field";
import type {
  MarketingAutomationBriefDefinition,
  ProjectBriefMutation,
  ProjectMemberOption,
} from "@openengage/core/projects";

export function emptyBrief(): ProjectBriefMutation {
  return {
    name: "",
    description: "",
    color: "#7c3aed",
    ownerUserId: "",
    approverUserId: "",
    primaryMotion: "onboarding",
    reviewAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    definition: {
      outcome: "",
      audience: "",
      lifecycleMoment: "",
      confidence: "low",
      entryTrigger: "",
      eligibility: [],
      exclusions: [],
      actions: [""],
      exitCondition: "",
      failureBehavior: "",
      consentRequirement: "",
      suppressionRules: "",
      frequencyPolicy: "",
      requiredData: [],
      requiredEvents: [],
      requiredContent: [],
      dependenciesAndApprovals: [],
      deliveryHorizon: "",
      measurement: {
        outcomeMetric: { name: "", proof: "" },
        earlySignal: { name: "", proof: "" },
        baseline: { kind: "unknown", discoveryTask: "" },
        successThreshold: "",
      },
      immediateNextSteps: [""],
      notIncluded: [],
      assumptions: [],
      followUpExperiment: null,
    },
  };
}

export function ProjectBriefForm({
  value,
  members,
  disabled = false,
  onChange,
}: {
  value: ProjectBriefMutation;
  members: ProjectMemberOption[];
  disabled?: boolean;
  onChange: (next: ProjectBriefMutation) => void;
}): ReactNode {
  const definition = value.definition;
  const updateDefinition = (patch: Partial<MarketingAutomationBriefDefinition>) =>
    onChange({ ...value, definition: { ...definition, ...patch } });
  return (
    <FieldGroup className="gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <FormInput
          name="briefName"
          label="施策名"
          value={value.name}
          disabled={disabled}
          maxLength={191}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
        <FormNativeSelect
          name="primaryMotion"
          label="主要モーション"
          value={value.primaryMotion}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              primaryMotion: event.target.value as ProjectBriefMutation["primaryMotion"],
            })
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
        rows={2}
        onChange={(event) => onChange({ ...value, description: event.target.value })}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <MemberSelect
          name="ownerUserId"
          label="担当者"
          value={value.ownerUserId}
          members={members}
          disabled={disabled}
          onChange={(ownerUserId) => onChange({ ...value, ownerUserId })}
        />
        <MemberSelect
          name="approverUserId"
          label="承認者"
          value={value.approverUserId}
          members={members}
          disabled={disabled}
          onChange={(approverUserId) => onChange({ ...value, approverUserId })}
        />
      </div>
      <FormInput
        name="reviewAt"
        label="レビュー日時"
        type="datetime-local"
        value={toLocalDateTime(value.reviewAt)}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...value, reviewAt: new Date(event.target.value).toISOString() })
        }
      />
      <Section title="Decision">
        <FormTextarea
          name="outcome"
          label="Outcome"
          value={definition.outcome}
          disabled={disabled}
          onChange={(event) => updateDefinition({ outcome: event.target.value })}
        />
        <FormTextarea
          name="audience"
          label="対象者"
          value={definition.audience}
          disabled={disabled}
          onChange={(event) => updateDefinition({ audience: event.target.value })}
        />
        <FormTextarea
          name="lifecycleMoment"
          label="ライフサイクル上の瞬間"
          value={definition.lifecycleMoment}
          disabled={disabled}
          onChange={(event) => updateDefinition({ lifecycleMoment: event.target.value })}
        />
        <FormNativeSelect
          name="confidence"
          label="確信度"
          value={definition.confidence}
          disabled={disabled}
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
      <Section title="Flow">
        <TextField
          name="entryTrigger"
          label="Entry trigger"
          value={definition.entryTrigger}
          disabled={disabled}
          onChange={(entryTrigger) => updateDefinition({ entryTrigger })}
        />
        <ListField
          name="eligibility"
          label="対象条件（1行1件）"
          value={definition.eligibility}
          disabled={disabled}
          onChange={(eligibility) => updateDefinition({ eligibility })}
        />
        <ListField
          name="exclusions"
          label="除外条件（1行1件）"
          value={definition.exclusions}
          disabled={disabled}
          onChange={(exclusions) => updateDefinition({ exclusions })}
        />
        <ListField
          name="actions"
          label="アクション（1行1ステップ）"
          value={definition.actions}
          disabled={disabled}
          onChange={(actions) => updateDefinition({ actions })}
        />
        <TextField
          name="exitCondition"
          label="終了条件"
          value={definition.exitCondition}
          disabled={disabled}
          onChange={(exitCondition) => updateDefinition({ exitCondition })}
        />
        <TextField
          name="failureBehavior"
          label="失敗時の対応"
          value={definition.failureBehavior}
          disabled={disabled}
          onChange={(failureBehavior) => updateDefinition({ failureBehavior })}
        />
      </Section>
      <Section title="Delivery">
        <TextField
          name="consentRequirement"
          label="同意要件"
          value={definition.consentRequirement}
          disabled={disabled}
          onChange={(consentRequirement) => updateDefinition({ consentRequirement })}
        />
        <TextField
          name="suppressionRules"
          label="抑止ルール"
          value={definition.suppressionRules}
          disabled={disabled}
          onChange={(suppressionRules) => updateDefinition({ suppressionRules })}
        />
        <TextField
          name="frequencyPolicy"
          label="頻度ポリシー"
          value={definition.frequencyPolicy}
          disabled={disabled}
          onChange={(frequencyPolicy) => updateDefinition({ frequencyPolicy })}
        />
        <ListField
          name="requiredData"
          label="必要データ"
          value={definition.requiredData}
          disabled={disabled}
          onChange={(requiredData) => updateDefinition({ requiredData })}
        />
        <ListField
          name="requiredEvents"
          label="必要イベント"
          value={definition.requiredEvents}
          disabled={disabled}
          onChange={(requiredEvents) => updateDefinition({ requiredEvents })}
        />
        <ListField
          name="requiredContent"
          label="必要コンテンツ"
          value={definition.requiredContent}
          disabled={disabled}
          onChange={(requiredContent) => updateDefinition({ requiredContent })}
        />
        <ListField
          name="dependenciesAndApprovals"
          label="依存関係・承認"
          value={definition.dependenciesAndApprovals}
          disabled={disabled}
          onChange={(dependenciesAndApprovals) => updateDefinition({ dependenciesAndApprovals })}
        />
        <TextField
          name="deliveryHorizon"
          label="実施時期"
          value={definition.deliveryHorizon}
          disabled={disabled}
          onChange={(deliveryHorizon) => updateDefinition({ deliveryHorizon })}
        />
      </Section>
      <Section title="Measurement">
        <TextField
          name="outcomeMetric"
          label="成果指標"
          value={definition.measurement.outcomeMetric.name}
          disabled={disabled}
          onChange={(name) =>
            updateDefinition({
              measurement: {
                ...definition.measurement,
                outcomeMetric: { ...definition.measurement.outcomeMetric, name },
              },
            })
          }
        />
        <TextField
          name="outcomeProof"
          label="成果を証明するイベント／フィールド"
          value={definition.measurement.outcomeMetric.proof}
          disabled={disabled}
          onChange={(proof) =>
            updateDefinition({
              measurement: {
                ...definition.measurement,
                outcomeMetric: { ...definition.measurement.outcomeMetric, proof },
              },
            })
          }
        />
        <TextField
          name="earlySignal"
          label="早期シグナル"
          value={definition.measurement.earlySignal.name}
          disabled={disabled}
          onChange={(name) =>
            updateDefinition({
              measurement: {
                ...definition.measurement,
                earlySignal: { ...definition.measurement.earlySignal, name },
              },
            })
          }
        />
        <TextField
          name="earlyProof"
          label="早期シグナルを証明するイベント／フィールド"
          value={definition.measurement.earlySignal.proof}
          disabled={disabled}
          onChange={(proof) =>
            updateDefinition({
              measurement: {
                ...definition.measurement,
                earlySignal: { ...definition.measurement.earlySignal, proof },
              },
            })
          }
        />
        <BaselineFields value={value} disabled={disabled} onChange={onChange} />
        <TextField
          name="successThreshold"
          label="成功基準"
          value={definition.measurement.successThreshold}
          disabled={disabled}
          onChange={(successThreshold) =>
            updateDefinition({ measurement: { ...definition.measurement, successThreshold } })
          }
        />
      </Section>
      <Section title="Next steps / Not included">
        <ListField
          name="immediateNextSteps"
          label="直近のアクション（1〜3件）"
          value={definition.immediateNextSteps}
          disabled={disabled}
          onChange={(immediateNextSteps) => updateDefinition({ immediateNextSteps })}
        />
        <ListField
          name="notIncluded"
          label="今回は含めないもの"
          value={definition.notIncluded}
          disabled={disabled}
          onChange={(notIncluded) => updateDefinition({ notIncluded })}
        />
        <ListField
          name="assumptions"
          label="前提"
          value={definition.assumptions}
          disabled={disabled}
          onChange={(assumptions) => updateDefinition({ assumptions })}
        />
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={definition.followUpExperiment !== null}
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
        {definition.followUpExperiment ? (
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
                name={`followUpExperiment.${key}`}
                label={label}
                value={definition.followUpExperiment?.[key] ?? ""}
                disabled={disabled}
                onChange={(next) =>
                  updateDefinition({
                    followUpExperiment: definition.followUpExperiment
                      ? { ...definition.followUpExperiment, [key]: next }
                      : null,
                  })
                }
              />
            ))}
          </div>
        ) : null}
      </Section>
    </FieldGroup>
  );
}

function MemberSelect({
  name,
  label,
  value,
  members,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  members: ProjectMemberOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <FormNativeSelect
      name={name}
      label={label}
      value={value}
      disabled={disabled}
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

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <fieldset className="grid gap-4 rounded-lg border p-4">
      <legend className="px-2 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function TextField({
  name,
  label,
  value,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <FormTextarea
      name={name}
      label={label}
      value={value}
      disabled={disabled}
      rows={2}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function ListField({
  name,
  label,
  value,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}): ReactNode {
  return (
    <FormTextarea
      name={name}
      label={label}
      value={value.join("\n")}
      disabled={disabled}
      rows={3}
      onChange={(event) => onChange(lines(event.target.value))}
    />
  );
}

function BaselineFields({
  value,
  disabled,
  onChange,
}: {
  value: ProjectBriefMutation;
  disabled: boolean;
  onChange: (next: ProjectBriefMutation) => void;
}): ReactNode {
  const baseline = value.definition.measurement.baseline;
  const update = (next: typeof baseline) =>
    onChange({
      ...value,
      definition: {
        ...value.definition,
        measurement: { ...value.definition.measurement, baseline: next },
      },
    });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormNativeSelect
        name="baselineKind"
        label="ベースライン種別"
        value={baseline.kind}
        disabled={disabled}
        onChange={(event) => {
          const kind = event.target.value;
          if (kind === "unknown") update({ kind, discoveryTask: "" });
          else if (kind === "assumption") update({ kind, value: "", evidenceThatWouldChange: "" });
          else update({ kind: "measured", value: "", source: "" });
        }}
      >
        <FormSelectOption value="unknown">未計測</FormSelectOption>
        <FormSelectOption value="assumption">仮定</FormSelectOption>
        <FormSelectOption value="measured">計測済み</FormSelectOption>
      </FormNativeSelect>
      {baseline.kind === "unknown" ? (
        <FormInput
          name="baselineDiscovery"
          label="確認タスク"
          value={baseline.discoveryTask}
          disabled={disabled}
          onChange={(event) => update({ ...baseline, discoveryTask: event.target.value })}
        />
      ) : (
        <>
          <FormInput
            name="baselineValue"
            label="ベースライン値"
            value={baseline.value}
            disabled={disabled}
            onChange={(event) => update({ ...baseline, value: event.target.value })}
          />
          <FormInput
            name="baselineEvidence"
            label={baseline.kind === "measured" ? "情報源" : "仮定を覆す証拠"}
            value={
              baseline.kind === "measured" ? baseline.source : baseline.evidenceThatWouldChange
            }
            disabled={disabled}
            onChange={(event) =>
              baseline.kind === "measured"
                ? update({ ...baseline, source: event.target.value })
                : update({ ...baseline, evidenceThatWouldChange: event.target.value })
            }
          />
        </>
      )}
    </div>
  );
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
