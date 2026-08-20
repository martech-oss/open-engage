import type { ReactNode } from "react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import type { ContactSummary } from "@openengage/core/contacts";

export function ContactsTable({
  contacts,
  columns,
  loading,
  pagination,
  onOpen,
}: {
  contacts: ContactSummary[];
  columns: DataTableColumn<ContactSummary>[];
  loading: boolean;
  pagination: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    onNext: () => void;
    onPrevious: () => void;
    rangeLabel: string;
  };
  onOpen: (contactId: string) => void;
}): ReactNode {
  return (
    <DataTable
      compact
      showColumnVisibility
      columns={columns}
      rows={contacts}
      rowKey={(contact) => contact.id}
      caption="連絡先一覧"
      loading={loading}
      skeletonRowCount={12}
      emptyTitle="条件に一致する連絡先がありません"
      emptyDescription="検索条件を変更するか、新しい連絡先を追加してください。"
      onRowClick={(contact) => onOpen(contact.id)}
      className="min-w-[900px]"
      containerClassName="min-h-0 flex-1 overflow-y-auto"
      pagination={pagination}
    />
  );
}
