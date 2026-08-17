import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { EmptyState } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  headClassName?: string;
  cellClassName?: string;
  /** Client-side sort for the currently loaded rows. Cursor pagination is unchanged. */
  sortValue?: (row: T) => string | number;
  /**
   * Shown in the column-visibility menu when `header` is not a string.
   * Select/actions columns default to not hideable.
   */
  label?: string;
  enableHiding?: boolean;
}

export interface DataTablePagination {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNext: () => void;
  onPrevious: () => void;
  /** Optional "1–50 / 1,842 件" style summary shown opposite the page buttons. */
  rangeLabel?: ReactNode;
}

/**
 * Renders `Table`/`TableHeader`/`TableBody` from a column config, plus the
 * loading-skeleton/empty-state/pagination-footer variants every hand-rolled
 * table in this app reimplemented slightly differently. Does not render the
 * surrounding `Card`/`CardHeader` — callers keep that, since its content
 * (title, filters, create buttons) varies too much to standardize.
 *
 * Sorting and column visibility are powered by TanStack Table and apply only
 * to the rows currently passed in (not the full server result set).
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
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  loading?: boolean;
  skeletonRowCount?: number;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  /** Applied to the scroll container, e.g. `min-h-0 flex-1` for a table that fills its card. */
  containerClassName?: string;
  /**
   * Dense list-screen treatment: fixed-height rows, hairline row rules and a
   * sticky monospace header, per the 新デザイン画面 contacts table.
   */
  compact?: boolean;
  pagination?: DataTablePagination;
  showColumnVisibility?: boolean;
}): ReactNode {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        accessorFn: column.sortValue ?? (() => ""),
        enableSorting: Boolean(column.sortValue),
        enableHiding: column.enableHiding ?? (column.key !== "select" && column.key !== "actions"),
        header: () => column.header,
        cell: ({ row }) => column.cell(row.original),
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => rowKey(row),
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const showEmpty = !loading && rows.length === 0;
  const showFooter = Boolean(pagination);

  return (
    <>
      <Table
        className={className}
        {...(containerClassName === undefined ? {} : { containerClassName })}
      >
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader
          className={cn(compact && "sticky top-0 z-10 bg-table-header [&_tr]:border-b-border")}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const column = columnConfig(columns, header.id);
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      header.column.getCanSort()
                        ? sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    className={cn(
                      compact &&
                        "h-auto py-1.5 font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase",
                      column?.headClassName,
                    )}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3 shrink-0 opacity-70" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3 shrink-0 opacity-70" />
                        ) : (
                          <ArrowUpDown className="size-3 shrink-0 opacity-40" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
              {showColumnVisibility ? (
                <TableHead
                  className={cn(
                    "w-[1%] px-2 text-right",
                    compact &&
                      "h-auto py-1.5 font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase",
                  )}
                >
                  <ColumnVisibilityMenu table={table} columns={columns} compact={compact} />
                </TableHead>
              ) : null}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: skeletonRowCount }).map((_, index) => (
                <TableRow key={index}>
                  {visibleColumns.map((tableColumn) => (
                    <TableCell
                      key={tableColumn.id}
                      className={columnConfig(columns, tableColumn.id)?.cellClassName}
                    >
                      <Skeleton className="h-5 w-full max-w-40" />
                    </TableCell>
                  ))}
                  {showColumnVisibility ? <TableCell className={cn(compact && "py-0")} /> : null}
                </TableRow>
              ))
            : table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    compact && "h-11 border-row-border",
                    onRowClick &&
                      "cursor-pointer focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                  )}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter") onRowClick(row.original);
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        compact && "py-0",
                        columnConfig(columns, cell.column.id)?.cellClassName,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                  {showColumnVisibility ? <TableCell className={cn(compact && "py-0")} /> : null}
                </TableRow>
              ))}
        </TableBody>
      </Table>
      {showEmpty ? (
        <EmptyState
          compact
          title={emptyTitle}
          {...(emptyDescription !== undefined ? { description: emptyDescription } : {})}
          {...(emptyAction !== undefined ? { action: emptyAction } : {})}
        />
      ) : null}
      {showFooter ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5">
          {pagination?.rangeLabel ? (
            <span className="mr-auto text-xs text-muted-foreground">{pagination.rangeLabel}</span>
          ) : null}
          {pagination ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasPreviousPage}
                onClick={pagination.onPrevious}
              >
                <ChevronLeft data-icon="inline-start" />
                前へ
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasNextPage}
                onClick={pagination.onNext}
              >
                次へ
                <ChevronRight data-icon="inline-end" />
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function columnConfig<T>(
  columns: DataTableColumn<T>[],
  key: string,
): DataTableColumn<T> | undefined {
  return columns.find((column) => column.key === key);
}

function columnLabel<T>(column: DataTableColumn<T>): string {
  if (column.label) return column.label;
  if (typeof column.header === "string" && column.header) return column.header;
  return column.key;
}

function ColumnVisibilityMenu<T>({
  table,
  columns,
  compact,
}: {
  table: TanstackTable<T>;
  columns: DataTableColumn<T>[];
  compact: boolean;
}): ReactNode {
  const hideable = table.getAllColumns().filter((column) => column.getCanHide());
  if (hideable.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? "icon-xs" : "sm"}
            aria-label="表示する列"
            className={cn(!compact && "-mr-1")}
          />
        }
      >
        <Columns3 data-icon="inline-start" />
        {compact ? null : "列"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>表示する列</DropdownMenuLabel>
          {hideable.map((tableColumn) => {
            const config = columnConfig(columns, tableColumn.id);
            const lastVisible =
              tableColumn.getIsVisible() && table.getVisibleLeafColumns().length === 1;
            return (
              <DropdownMenuCheckboxItem
                key={tableColumn.id}
                checked={tableColumn.getIsVisible()}
                disabled={lastVisible}
                onCheckedChange={(visible) => tableColumn.toggleVisibility(visible)}
              >
                {config ? columnLabel(config) : tableColumn.id}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
