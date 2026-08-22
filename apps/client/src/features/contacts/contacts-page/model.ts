import { exportCsv } from "@/lib/csv";
import type { ContactSummary } from "@openengage/core/contacts";

import type { ContactOptions, ContactSearch } from "../contact-api";
import type { BulkAction } from "../contact-bits";
import { contactName } from "../contact-bits";
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

export function exportVisibleContacts(
  contacts: ContactSummary[],
  formatLongDateTime: (value: string) => string,
): void {
  exportCsv(
    "contacts.csv",
    contacts.map((contact) => ({
      名前: contactName(contact),
      メール: contact.email ?? "",
      電話番号: contact.phone ?? "",
      状態: contact.status,
      ステージ: contact.stage,
      会社: contact.companies.map((company) => company.name).join(" / "),
      タグ: contact.tags.map((tag) => tag.name).join(" / "),
      スコア: contact.score,
      更新日: formatLongDateTime(contact.updatedAt),
    })),
  );
}
