import type { SegmentDefinition, SegmentRow } from "@openengage/core/segments";

export function audienceGroupLabel(kind: SegmentRow["kind"]): string {
  return kind === "static" ? "リスト" : "セグメント";
}

export function evaluationLabel(segment: SegmentRow): string {
  switch (segment.evaluationStatus) {
    case "pending":
      return "更新待ち";
    case "running":
      return "更新中";
    case "failed":
      return "更新失敗";
    case "ready":
      return "最新";
  }
}

export function toSegmentDefinition(segment: SegmentRow): SegmentDefinition {
  return {
    name: segment.name,
    slug: segment.slug,
    description: segment.description,
    kind: segment.kind,
    filter: segment.filterAst,
    membershipSource: segment.membershipSource,
  };
}
