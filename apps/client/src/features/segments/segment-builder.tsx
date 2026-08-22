import type { ReactNode } from "react";

import type { SegmentFilter, SegmentGenerationCatalog } from "@openengage/core/segments";

import {
  appendSegmentCondition,
  appendSegmentGroup,
  createDefaultSegmentFilter,
  removeSegmentNode,
  replaceSegmentNode,
} from "./segment-builder-model";
import { SegmentFilterNodeEditor } from "./segment-filter-node-editor";

export function SegmentBuilder({
  value,
  catalog,
  onChange,
}: {
  value: SegmentFilter;
  catalog: SegmentGenerationCatalog;
  onChange: (filter: SegmentFilter) => void;
}): ReactNode {
  return (
    <SegmentFilterNodeEditor
      node={value}
      path={[]}
      catalog={catalog}
      onReplace={(path, node) => onChange(replaceSegmentNode(value, path, node))}
      onRemove={(path) => onChange(removeSegmentNode(value, path, catalog))}
      onAppendCondition={(path) => onChange(appendSegmentCondition(value, path, catalog))}
      onAppendGroup={(path) => onChange(appendSegmentGroup(value, path, catalog))}
    />
  );
}

export const defaultSegmentFilter = createDefaultSegmentFilter;
