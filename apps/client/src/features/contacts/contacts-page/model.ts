import type { ContactOptions, ContactSearch } from "../contact-api";
import type { BulkAction } from "../contact-bits";
import type { ContactFilters } from "../contact-filters";
import { createSegmentFilter } from "../segment-filter";

export type BulkActionDefinition = {
  action: BulkAction;
  label: string;
  resource?: "tag" | "segment";
};

export const BULK_ACTIONS: BulkActionDefinition[] = [
  { action: "add_tag", label: "タグを追加", resource: "tag" },
  { action: "add_segment", label: "リストへ追加", resource: "segment" },
  { action: "archive", label: "アーカイブ" },
];

export function contactPaginationKey(search: ContactSearch): string {
  return JSON.stringify([
    search.q,
    search.status,
    search.stage,
    search.tagId,
    search.companyId,
    search.segmentId,
    search.scoreMin,
    search.scoreMax,
    search.sort,
    search.direction,
  ]);
}

export function selectedSegmentFilter(filters: ContactFilters, options: ContactOptions) {
  return createSegmentFilter(
    {
      q: filters.query,
      status: filters.status,
      stage: filters.stage,
      tagId: filters.tagId,
      companyId: filters.companyId,
      scoreMin: filters.scoreMin,
      scoreMax: filters.scoreMax,
    },
    options,
  );
}
