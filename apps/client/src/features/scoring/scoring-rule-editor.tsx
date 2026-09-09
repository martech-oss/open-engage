import type { FormEvent, ReactNode } from "react";

import { FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import { FormDialog } from "@/components/app-ui/dialogs";
import { FieldGroup } from "@/components/ui/field";
import type { ContactOptions } from "@/features/contacts/contact-api";
import { SCORING_EVENT_TYPES, SCORING_MATCH_TYPES } from "@openengage/core/scoring";

import type { ScoringCategoryRow, ScoringRuleRow } from "./scoring-api";
import { matchValueLabel, SCORING_EVENT_LABELS, SCORING_MATCH_LABELS } from "./scoring-labels";

export type ScoringRuleEditorViewProps = {
  item: ScoringRuleRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string;
  matchType: ScoringRuleRow["matchType"];
  onMatchTypeChange: (matchType: ScoringRuleRow["matchType"]) => void;
  categories: ScoringCategoryRow[];
  tags: ContactOptions["tags"];
};

export function ScoringRuleEditorView({
  item,
  open,
  onOpenChange,
  onSubmit,
  busy,
  error,
  matchType,
  onMatchTypeChange,
  categories,
  tags,
}: ScoringRuleEditorViewProps): ReactNode {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "スコアリングルールを編集" : "スコアリングルールを作成"}
      description="対象の行動と、一致したときに動かす点数・タグを設定します。"
      className="sm:max-w-2xl"
      onSubmit={onSubmit}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "ルールを作成"}
    >
      <FormInput
        label="ルール名"
        name="name"
        defaultValue={item?.name}
        placeholder="料金ページを閲覧"
        required
      />
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormNativeSelect
          label="対象の行動"
          name="eventType"
          defaultValue={item?.eventType ?? "page_viewed"}
        >
          {SCORING_EVENT_TYPES.map((type) => (
            <FormSelectOption key={type} value={type}>
              {SCORING_EVENT_LABELS[type]}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect
          label="一致条件"
          name="matchType"
          defaultValue={item?.matchType ?? "any"}
          onChange={(event) =>
            onMatchTypeChange(event.currentTarget.value as ScoringRuleRow["matchType"])
          }
        >
          {SCORING_MATCH_TYPES.map((type) => (
            <FormSelectOption key={type} value={type}>
              {SCORING_MATCH_LABELS[type]}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </FieldGroup>
      {matchType !== "any" ? (
        <FormInput
          label={matchValueLabel(matchType)}
          name="matchValue"
          defaultValue={item?.matchValue ?? ""}
          description={
            matchType === "resource"
              ? "フォームID、計測用リンクID、カスタムイベント名などを指定します。"
              : "計測されたページURLと突き合わせます。"
          }
          placeholder={matchType === "resource" ? "019f..." : "/pricing"}
          required
        />
      ) : null}
      <FieldGroup className="grid gap-4 sm:grid-cols-3">
        <FormInput
          label="点数"
          name="points"
          type="number"
          defaultValue={item?.points ?? 5}
          description="マイナスも指定できます。"
          required
        />
        <FormNativeSelect label="カテゴリ" name="categoryId" defaultValue={item?.categoryId ?? ""}>
          <FormSelectOption value="">全体スコアのみ</FormSelectOption>
          {categories.map((category) => (
            <FormSelectOption key={category.id} value={category.id}>
              {category.name}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect label="タグを付与" name="tagId" defaultValue={item?.tagId ?? ""}>
          <FormSelectOption value="">付与しない</FormSelectOption>
          {tags.map((tag) => (
            <FormSelectOption key={tag.id} value={tag.id}>
              {tag.name}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </FieldGroup>
      <ScoringLifetimeFields item={item} />
      <FormNativeSelect
        label="状態"
        name="enabled"
        defaultValue={item && !item.enabled ? "disabled" : "enabled"}
      >
        <FormSelectOption value="enabled">有効</FormSelectOption>
        <FormSelectOption value="disabled">停止中</FormSelectOption>
      </FormNativeSelect>
    </FormDialog>
  );
}

function ScoringLifetimeFields({ item }: Pick<ScoringRuleEditorViewProps, "item">): ReactNode {
  return (
    <FieldGroup className="grid gap-4 sm:grid-cols-2">
      <FormInput
        label="減衰日数"
        name="decayDays"
        type="number"
        min={1}
        max={3650}
        step={1}
        defaultValue={item?.decayDays ?? ""}
        description="正の加点のみ。イベントから指定日数で0点になります。空欄は減衰なし。"
      />
      <FormInput
        label="コンタクトごとの加点上限"
        name="maxScore"
        type="number"
        min={1}
        max={1000000}
        step={1}
        defaultValue={item?.maxScore ?? ""}
        description="このルールが残している加点の合計上限。空欄は上限なし。"
      />
    </FieldGroup>
  );
}
