import type { ReactNode } from "react";

import { ArrayField } from "./array-field";
import { errorAt } from "./draft";
import { Section, TextField, type BriefSectionProps } from "./shared";

export function FlowSection(props: BriefSectionProps): ReactNode {
  const { definition, disabled, errors, updateDefinition } = props;
  return (
    <Section title="Flow">
      <TextField
        name="definition.entryTrigger"
        label="Entry trigger"
        value={definition.entryTrigger}
        disabled={disabled}
        error={errorAt(errors, "definition.entryTrigger")}
        onChange={(entryTrigger) => updateDefinition({ entryTrigger })}
      />
      <ArrayField
        name="definition.eligibility"
        label="対象条件"
        value={definition.eligibility}
        disabled={disabled}
        errors={errors}
        onChange={(eligibility) => updateDefinition({ eligibility })}
      />
      <ArrayField
        name="definition.exclusions"
        label="除外条件"
        value={definition.exclusions}
        disabled={disabled}
        errors={errors}
        onChange={(exclusions) => updateDefinition({ exclusions })}
      />
      <ArrayField
        name="definition.actions"
        label="アクション"
        value={definition.actions}
        disabled={disabled}
        errors={errors}
        minItems={1}
        maxItems={25}
        onChange={(actions) => updateDefinition({ actions })}
      />
      <TextField
        name="definition.exitCondition"
        label="終了条件"
        value={definition.exitCondition}
        disabled={disabled}
        error={errorAt(errors, "definition.exitCondition")}
        onChange={(exitCondition) => updateDefinition({ exitCondition })}
      />
      <TextField
        name="definition.failureBehavior"
        label="失敗時の対応"
        value={definition.failureBehavior}
        disabled={disabled}
        error={errorAt(errors, "definition.failureBehavior")}
        onChange={(failureBehavior) => updateDefinition({ failureBehavior })}
      />
    </Section>
  );
}

export function DeliverySection(props: BriefSectionProps): ReactNode {
  const { definition, disabled, errors, updateDefinition } = props;
  return (
    <Section title="Delivery">
      <TextField
        name="definition.consentRequirement"
        label="同意要件"
        value={definition.consentRequirement}
        disabled={disabled}
        error={errorAt(errors, "definition.consentRequirement")}
        onChange={(consentRequirement) => updateDefinition({ consentRequirement })}
      />
      <TextField
        name="definition.suppressionRules"
        label="抑止ルール"
        value={definition.suppressionRules}
        disabled={disabled}
        error={errorAt(errors, "definition.suppressionRules")}
        onChange={(suppressionRules) => updateDefinition({ suppressionRules })}
      />
      <TextField
        name="definition.frequencyPolicy"
        label="頻度ポリシー"
        value={definition.frequencyPolicy}
        disabled={disabled}
        error={errorAt(errors, "definition.frequencyPolicy")}
        onChange={(frequencyPolicy) => updateDefinition({ frequencyPolicy })}
      />
      <ArrayField
        name="definition.requiredData"
        label="必要データ"
        value={definition.requiredData}
        disabled={disabled}
        errors={errors}
        onChange={(requiredData) => updateDefinition({ requiredData })}
      />
      <ArrayField
        name="definition.requiredEvents"
        label="必要イベント"
        value={definition.requiredEvents}
        disabled={disabled}
        errors={errors}
        onChange={(requiredEvents) => updateDefinition({ requiredEvents })}
      />
      <ArrayField
        name="definition.requiredContent"
        label="必要コンテンツ"
        value={definition.requiredContent}
        disabled={disabled}
        errors={errors}
        onChange={(requiredContent) => updateDefinition({ requiredContent })}
      />
      <ArrayField
        name="definition.dependenciesAndApprovals"
        label="依存関係・承認"
        value={definition.dependenciesAndApprovals}
        disabled={disabled}
        errors={errors}
        onChange={(dependenciesAndApprovals) => updateDefinition({ dependenciesAndApprovals })}
      />
      <TextField
        name="definition.deliveryHorizon"
        label="実施時期"
        value={definition.deliveryHorizon}
        disabled={disabled}
        error={errorAt(errors, "definition.deliveryHorizon")}
        onChange={(deliveryHorizon) => updateDefinition({ deliveryHorizon })}
      />
    </Section>
  );
}
