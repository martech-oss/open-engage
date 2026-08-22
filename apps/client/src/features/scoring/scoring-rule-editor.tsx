import type { FormEvent, ReactNode } from "react";

import { FormDialog, FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import { FieldGroup } from "@/components/ui/field";
import { getFormString } from "@/lib/form-data";
import {
  SCORING_EVENT_TYPES,
  SCORING_MATCH_TYPES,
  type ScoringRuleWrite,
} from "@openengage/core/scoring";

import type { ScoringRuleRow } from "./scoring-api";
import { useScoringRuleEditorController } from "./scoring-editor-controllers";
import { matchValueLabel, SCORING_EVENT_LABELS, SCORING_MATCH_LABELS } from "./scoring-labels";

export function ScoringRuleEditor({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: ScoringRuleRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}): ReactNode {
  const controller = useScoringRuleEditorController(item, onSaved);
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void controller.save(readRuleValues(new FormData(event.currentTarget)));
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "スコアリングルールを編集" : "スコアリングルールを作成"}
      description="対象の行動と、一致したときに動かす点数・タグを設定します。"
      className="sm:max-w-2xl"
      onSubmit={submit}
      busy={controller.busy}
      error={controller.error}
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
            controller.setMatchType(event.currentTarget.value as ScoringRuleRow["matchType"])
          }
        >
          {SCORING_MATCH_TYPES.map((type) => (
            <FormSelectOption key={type} value={type}>
              {SCORING_MATCH_LABELS[type]}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </FieldGroup>
      {controller.matchType !== "any" ? (
        <FormInput
          label={matchValueLabel(controller.matchType)}
          name="matchValue"
          defaultValue={item?.matchValue ?? ""}
          description={
            controller.matchType === "resource"
              ? "フォームID、計測用リンクID、カスタムイベント名などを指定します。"
              : "計測されたページURLと突き合わせます。"
          }
          placeholder={controller.matchType === "resource" ? "019f..." : "/pricing"}
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
          {controller.categories.map((category) => (
            <FormSelectOption key={category.id} value={category.id}>
              {category.name}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect label="タグを付与" name="tagId" defaultValue={item?.tagId ?? ""}>
          <FormSelectOption value="">付与しない</FormSelectOption>
          {controller.contactOptions.tags.map((tag) => (
            <FormSelectOption key={tag.id} value={tag.id}>
              {tag.name}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </FieldGroup>
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

function readRuleValues(form: FormData): ScoringRuleWrite {
  const matchValue = getFormString(form, "matchValue").trim();
  const categoryId = getFormString(form, "categoryId");
  const tagId = getFormString(form, "tagId");
  return {
    name: getFormString(form, "name"),
    eventType: getFormString(form, "eventType") as ScoringRuleRow["eventType"],
    matchType: getFormString(form, "matchType") as ScoringRuleRow["matchType"],
    matchValue: matchValue || null,
    points: Number(getFormString(form, "points")) || 0,
    categoryId: categoryId || null,
    tagId: tagId || null,
    enabled: getFormString(form, "enabled") !== "disabled",
  };
}
