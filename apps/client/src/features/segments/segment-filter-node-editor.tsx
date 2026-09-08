import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { SegmentFilter, SegmentGenerationCatalog } from "@openengage/core/segments";

import type { SegmentDefaultValues } from "./segment-builder-model";
import { SegmentConditionEditor } from "./segment-condition-editor";

type NodeEditorProps = {
  inheritedRelation?: "company" | "deal" | "event" | undefined;
  node: SegmentFilter;
  path: number[];
  catalog: SegmentGenerationCatalog;
  defaults: SegmentDefaultValues;
  onReplace: (path: number[], node: SegmentFilter) => void;
  onRemove: (path: number[]) => void;
  onAppendCondition: (path: number[]) => void;
  onAppendGroup: (path: number[]) => void;
};

export function SegmentFilterNodeEditor(props: NodeEditorProps): ReactNode {
  const { node, path, catalog, defaults, onReplace, onRemove, onAppendCondition, onAppendGroup } =
    props;
  if (node.kind === "condition") {
    return (
      <SegmentConditionEditor
        condition={node}
        catalog={catalog}
        defaults={defaults}
        onChange={(condition) => onReplace(path, condition)}
        {...(path.length === 0 ? {} : { onRemove: () => onRemove(path) })}
      />
    );
  }
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <GroupHeader
        combinator={node.combinator}
        removable={path.length > 0}
        onCombinatorChange={(combinator) => onReplace(path, { ...node, combinator })}
        onRemove={() => onRemove(path)}
      />
      <div className="flex gap-2">
        <NativeSelect
          aria-label="関連行の範囲"
          value={props.inheritedRelation ?? node.relation ?? "contact"}
          disabled={props.inheritedRelation !== undefined}
          onChange={(event) => {
            const { relation: _relation, minimumCount: _count, ...rest } = node;
            onReplace(
              path,
              event.target.value === "contact"
                ? rest
                : { ...rest, relation: event.target.value as "company" | "deal" | "event" },
            );
          }}
        >
          <NativeSelectOption value="contact">コンタクト条件</NativeSelectOption>
          <NativeSelectOption value="company">同じ会社</NativeSelectOption>
          <NativeSelectOption value="deal">同じ商談</NativeSelectOption>
          <NativeSelectOption value="event">同じイベント</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          aria-label="一致の有無"
          value={node.negated ? "no" : "yes"}
          onChange={(event) => onReplace(path, { ...node, negated: event.target.value === "no" })}
        >
          <NativeSelectOption value="yes">一致する</NativeSelectOption>
          <NativeSelectOption value="no">一致しない</NativeSelectOption>
        </NativeSelect>
        {node.relation === "event" && (
          <Input
            type="number"
            min={1}
            aria-label="最小イベント数"
            value={node.minimumCount ?? 1}
            onChange={(event) =>
              onReplace(path, { ...node, minimumCount: Math.max(1, Number(event.target.value)) })
            }
          />
        )}
      </div>
      <div className="space-y-2">
        {node.children.map((child, index) => (
          <SegmentFilterNodeEditor
            key={`${path.join("-")}-${index}`}
            {...props}
            inheritedRelation={node.relation ?? props.inheritedRelation}
            node={child}
            path={[...path, index]}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onAppendCondition(path)}>
          <Plus data-icon="inline-start" />
          条件を追加
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onAppendGroup(path)}>
          <Plus data-icon="inline-start" />
          グループを追加
        </Button>
      </div>
    </div>
  );
}

function GroupHeader({
  combinator,
  removable,
  onCombinatorChange,
  onRemove,
}: {
  combinator: "and" | "or";
  removable: boolean;
  onCombinatorChange: (value: "and" | "or") => void;
  onRemove: () => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">条件グループ</span>
      <NativeSelect
        value={combinator}
        aria-label="条件の組み合わせ"
        className="w-32"
        onChange={(event) => onCombinatorChange(event.target.value as "and" | "or")}
      >
        <NativeSelectOption value="and">すべて満たす</NativeSelectOption>
        <NativeSelectOption value="or">いずれか満たす</NativeSelectOption>
      </NativeSelect>
      {removable ? (
        <Button variant="ghost" size="icon-xs" aria-label="グループを削除" onClick={onRemove}>
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}
