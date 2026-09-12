import { flexRender, type Table as TanstackTable } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { findDataTableColumn, type DataTableColumn } from "./data-table-types";

export function DataTableHeader<T>({
  table,
  columns,
  compact,
  showColumnVisibility,
}: {
  table: TanstackTable<T>;
  columns: DataTableColumn<T>[];
  compact: boolean;
  showColumnVisibility: boolean;
}): ReactNode {
  return (
    <TableHeader
      className={cn(compact && "sticky top-0 z-10 bg-table-header [&_tr]:border-b-border")}
    >
      {table.getHeaderGroups().map((headerGroup) => (
        <TableRow key={headerGroup.id}>
          {headerGroup.headers.map((header) => {
            const column = findDataTableColumn(columns, header.id);
            const sorted = header.column.getIsSorted();
            return (
              <TableHead
                key={header.id}
                aria-sort={sortAriaValue(header.column.getCanSort(), sorted)}
                className={cn(
                  compact && "h-10 py-2 text-xs font-medium text-muted-foreground",
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
                    <SortIcon sorted={sorted} />
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
                compact && "h-10 py-2 text-xs font-medium text-muted-foreground",
              )}
            >
              <ColumnVisibilityMenu table={table} columns={columns} compact={compact} />
            </TableHead>
          ) : null}
        </TableRow>
      ))}
    </TableHeader>
  );
}

function SortIcon({ sorted }: { sorted: false | "asc" | "desc" }): ReactNode {
  if (sorted === "asc") return <ArrowUp className="size-3 shrink-0 opacity-70" />;
  if (sorted === "desc") return <ArrowDown className="size-3 shrink-0 opacity-70" />;
  return <ArrowUpDown className="size-3 shrink-0 opacity-40" />;
}

function sortAriaValue(canSort: boolean, sorted: false | "asc" | "desc") {
  if (!canSort) return undefined;
  if (sorted === "asc") return "ascending" as const;
  if (sorted === "desc") return "descending" as const;
  return "none" as const;
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
            const config = findDataTableColumn(columns, tableColumn.id);
            const lastVisible =
              tableColumn.getIsVisible() && table.getVisibleLeafColumns().length === 1;
            return (
              <DropdownMenuCheckboxItem
                key={tableColumn.id}
                checked={tableColumn.getIsVisible()}
                disabled={lastVisible}
                onCheckedChange={(visible) => tableColumn.toggleVisibility(visible)}
              >
                {config?.label ??
                  (typeof config?.header === "string" ? config.header : tableColumn.id)}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
