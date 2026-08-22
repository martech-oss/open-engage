import type { FormEvent, ReactNode } from "react";

import type { DataTableColumn } from "@/components/data-table";
import { getFormString } from "@/lib/form-data";
import type { GradingCriterionWrite, ScoringRuleWrite } from "@openengage/core/scoring";

import type { GradingCriterionRow, ScoringCategoryRow, ScoringRuleRow } from "./scoring-api";
import { CategoryCardView } from "./scoring-category-card";
import {
  useGradingCriterionEditorController,
  useScoringCategoryEditorController,
  useScoringRuleEditorController,
} from "./scoring-editor-controllers";
import { GradingCriterionEditorView } from "./scoring-grading-editor";
import { ScoringRuleEditorView } from "./scoring-rule-editor";

type EditorShellProps<Row> = {
  item: Row | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function ScoringRuleEditorShell({
  item,
  open,
  onOpenChange,
  onSaved,
}: EditorShellProps<ScoringRuleRow>): ReactNode {
  const controller = useScoringRuleEditorController(item, onSaved);
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void controller.save(readRuleValues(new FormData(event.currentTarget)));
  }
  return (
    <ScoringRuleEditorView
      item={item}
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      busy={controller.busy}
      error={controller.error}
      matchType={controller.matchType}
      onMatchTypeChange={controller.setMatchType}
      categories={controller.categories}
      tags={controller.contactOptions.tags}
    />
  );
}

export function GradingCriterionEditorShell({
  item,
  open,
  onOpenChange,
  onSaved,
}: EditorShellProps<GradingCriterionRow>): ReactNode {
  const controller = useGradingCriterionEditorController(item, onSaved);
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void controller.save(readCriterionValues(new FormData(event.currentTarget)));
  }
  return (
    <GradingCriterionEditorView
      item={item}
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      busy={controller.busy}
      error={controller.error}
      field={controller.field}
      onFieldChange={controller.setField}
    />
  );
}

export function ScoringCategoryCardShell({
  categories,
  columns,
  open,
  onOpenChange,
}: {
  categories: ScoringCategoryRow[];
  columns: DataTableColumn<ScoringCategoryRow>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const controller = useScoringCategoryEditorController(() => onOpenChange(false));
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void controller.save({ name: getFormString(form, "name"), slug: getFormString(form, "slug") });
  }
  return (
    <CategoryCardView
      categories={categories}
      columns={columns}
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      busy={controller.busy}
      error={controller.error}
    />
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

function readCriterionValues(form: FormData): GradingCriterionWrite {
  const fieldKey = getFormString(form, "fieldKey").trim();
  return {
    name: getFormString(form, "name"),
    field: getFormString(form, "field") as GradingCriterionRow["field"],
    fieldKey: fieldKey || null,
    operator: getFormString(form, "operator") as GradingCriterionRow["operator"],
    value: getFormString(form, "value"),
    steps: Number(getFormString(form, "steps")) || 0,
    enabled: getFormString(form, "enabled") !== "disabled",
  };
}
