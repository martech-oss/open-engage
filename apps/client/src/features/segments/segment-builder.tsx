import type { ReactNode } from "react";

import type { SegmentFilter, SegmentGenerationCatalog } from "@openengage/core/segments";

import {
  appendSegmentCondition,
  appendSegmentGroup,
  type SegmentDefaultValues,
  removeSegmentNode,
  replaceSegmentNode,
} from "./segment-builder-model";
import { SegmentFilterNodeEditor } from "./segment-filter-node-editor";

export function SegmentBuilder({
  value,
  catalog,
  defaults,
  onChange,
}: {
  value: SegmentFilter;
  catalog: SegmentGenerationCatalog;
  defaults: SegmentDefaultValues;
  onChange: (filter: SegmentFilter) => void;
}): ReactNode {
  return (
    <SegmentFilterNodeEditor
      node={value}
      path={[]}
      catalog={catalog}
      onReplace={(path, node) => onChange(replaceSegmentNode(value, path, node))}
      defaults={defaults}
      onRemove={(path) => onChange(removeSegmentNode(value, path, catalog, defaults))}
      onAppendCondition={(path) => onChange(appendSegmentCondition(value, path, catalog, defaults))}
      onAppendGroup={(path) => onChange(appendSegmentGroup(value, path, catalog, defaults))}
    />
  );
}
