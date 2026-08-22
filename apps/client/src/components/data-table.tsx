import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { type ReactNode, useMemo, useState } from "react";

import { EmptyState } from "@/components/app-ui";
import { Table, TableCaption } from "@/components/ui/table";

import { DataTableBody } from "./data-table-body";
import { DataTableFooter } from "./data-table-footer";
import { DataTableHeader } from "./data-table-header";
import type { DataTableProps } from "./data-table-types";

export type { DataTableColumn, DataTablePagination } from "./data-table-types";

/**
 * Shared table shell. Local TanStack sorting is available only for complete
 * lists; supplying pagination leaves ordering under the server/URL query.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  skeletonRowCount = 5,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  className,
  containerClassName,
  compact = false,
  pagination,
  showColumnVisibility = false,
}: DataTableProps<T>): ReactNode {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const localSorting = pagination === undefined;
  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        accessorFn: localSorting && column.sortValue ? column.sortValue : () => "",
        enableSorting: localSorting && Boolean(column.sortValue),
        enableHiding: column.enableHiding ?? (column.key !== "select" && column.key !== "actions"),
        header: () => column.header,
        cell: ({ row }) => column.cell(row.original),
      })),
    [columns, localSorting],
  );
  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: { sorting: localSorting ? sorting : [], columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => rowKey(row),
  });

  return (
    <>
      <Table
        className={className}
        {...(containerClassName === undefined ? {} : { containerClassName })}
      >
        <TableCaption className="sr-only">{caption}</TableCaption>
        <DataTableHeader
          table={table}
          columns={columns}
          compact={compact}
          showColumnVisibility={showColumnVisibility}
        />
        <DataTableBody
          table={table}
          columns={columns}
          loading={loading}
          skeletonRowCount={skeletonRowCount}
          compact={compact}
          showColumnVisibility={showColumnVisibility}
          {...(onRowClick ? { onRowClick } : {})}
        />
      </Table>
      {!loading && rows.length === 0 ? (
        <EmptyState
          compact
          title={emptyTitle}
          {...(emptyDescription !== undefined ? { description: emptyDescription } : {})}
          {...(emptyAction !== undefined ? { action: emptyAction } : {})}
        />
      ) : null}
      {pagination ? <DataTableFooter pagination={pagination} /> : null}
    </>
  );
}
