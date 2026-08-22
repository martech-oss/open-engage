import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { SegmentFilter, SegmentGenerationCatalog } from "@openengage/core/segments";

import { SegmentConditionEditor } from "./segment-condition-editor";

type NodeEditorProps = {
  node: SegmentFilter;
  path: number[];
  catalog: SegmentGenerationCatalog;
  onReplace: (path: number[], node: SegmentFilter) => void;
  onRemove: (path: number[]) => void;
  onAppendCondition: (path: number[]) => void;
  onAppendGroup: (path: number[]) => void;
};

export function SegmentFilterNodeEditor(props: NodeEditorProps): ReactNode {
  const { node, path, catalog, onReplace, onRemove, onAppendCondition, onAppendGroup } = props;
  if (node.kind === "condition") {
    return (
      <SegmentConditionEditor
        condition={node}
        catalog={catalog}
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
      <div className="space-y-2">
        {node.children.map((child, index) => (
          <SegmentFilterNodeEditor
            key={`${path.join("-")}-${index}`}
            {...props}
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
