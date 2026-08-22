import { Pencil } from "lucide-react";

import { ArchiveConfirm } from "@/components/app-ui";
import type { DataTableColumn } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { GradingCriterionRow, ScoringRuleRow } from "./scoring-api";
import {
  GRADING_FIELD_LABELS,
  GRADING_OPERATOR_LABELS,
  SCORING_EVENT_LABELS,
  SCORING_MATCH_LABELS,
} from "./scoring-labels";

export function scoringRuleColumns(
  onEdit: (item: ScoringRuleRow) => void,
  onArchive: (item: ScoringRuleRow) => Promise<void>,
): DataTableColumn<ScoringRuleRow>[] {
  return [
    {
      key: "name",
      header: "ルール",
      cell: (item) => (
        <div className="flex max-w-80 flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">
            {SCORING_EVENT_LABELS[item.eventType]} ・ {SCORING_MATCH_LABELS[item.matchType]}
            {item.matchValue ? `「${item.matchValue}」` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "points",
      header: "点数",
      cell: (item) => (
        <span className={item.points < 0 ? "text-destructive" : undefined}>
          {item.points > 0 ? `+${item.points}` : item.points}
        </span>
      ),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "category",
      header: "カテゴリ",
      cell: (item) =>
        item.categoryName ? (
          <Badge variant="secondary">{item.categoryName}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">全体スコアのみ</span>
        ),
    },
    {
      key: "tag",
      header: "タグ付与",
      cell: (item) =>
        item.tagName ? (
          <Badge variant="outline">{item.tagName}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    statusColumn(),
    actionColumn(onEdit, onArchive),
  ];
}

export function gradingCriterionColumns(
  onEdit: (item: GradingCriterionRow) => void,
  onArchive: (item: GradingCriterionRow) => Promise<void>,
): DataTableColumn<GradingCriterionRow>[] {
  return [
    {
      key: "name",
      header: "条件",
      cell: (item) => (
        <div className="flex max-w-80 flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">
            {GRADING_FIELD_LABELS[item.field] ?? item.field}
            {item.fieldKey ? `（${item.fieldKey}）` : ""} が{" "}
            {GRADING_OPERATOR_LABELS[item.operator]}
            {item.value ? `「${item.value}」` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "steps",
      header: "移動量",
      cell: (item) => (
        <span className={item.steps < 0 ? "text-destructive" : undefined}>
          {item.steps > 0 ? `+${item.steps}` : item.steps} / 3文字
        </span>
      ),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    statusColumn(),
    actionColumn(onEdit, onArchive, true),
  ];
}

function statusColumn<Row extends { enabled: boolean }>(): DataTableColumn<Row> {
  return {
    key: "enabled",
    header: "状態",
    cell: (item) => (
      <Badge variant={item.enabled ? "default" : "secondary"}>
        {item.enabled ? "有効" : "停止中"}
      </Badge>
    ),
  };
}

function actionColumn<Row extends { id: string; name: string }>(
  onEdit: (item: Row) => void,
  onArchive: (item: Row) => Promise<void>,
  grading = false,
): DataTableColumn<Row> {
  return {
    key: "actions",
    header: "操作",
    cell: (item) => (
      <div className="flex justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${item.name}を編集`}
          onClick={() => onEdit(item)}
        >
          <Pencil />
        </Button>
        <ArchiveConfirm
          label={item.name}
          description={
            grading
              ? `「${item.name}」を削除すると、以後のグレード再計算で評価されなくなります。`
              : `「${item.name}」は以後のイベントで加点しなくなります。過去のスコアはそのまま残ります。`
          }
          onConfirm={() => onArchive(item)}
        />
      </div>
    ),
    headClassName: "text-right",
  };
}
