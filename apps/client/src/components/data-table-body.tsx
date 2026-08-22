import { flexRender, type Table as TanstackTable } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { findDataTableColumn, type DataTableColumn } from "./data-table-types";

export function DataTableBody<T>({
  table,
  columns,
  loading,
  skeletonRowCount,
  compact,
  showColumnVisibility,
  onRowClick,
}: {
  table: TanstackTable<T>;
  columns: DataTableColumn<T>[];
  loading: boolean;
  skeletonRowCount: number;
  compact: boolean;
  showColumnVisibility: boolean;
  onRowClick?: (row: T) => void;
}): ReactNode {
  if (loading) {
    return (
      <TableBody>
        {Array.from({ length: skeletonRowCount }).map((_, index) => (
          <TableRow key={index}>
            {table.getVisibleLeafColumns().map((tableColumn) => (
              <TableCell
                key={tableColumn.id}
                className={findDataTableColumn(columns, tableColumn.id)?.cellClassName}
              >
                <Skeleton className="h-5 w-full max-w-40" />
              </TableCell>
            ))}
            {showColumnVisibility ? <TableCell className={cn(compact && "py-0")} /> : null}
          </TableRow>
        ))}
      </TableBody>
    );
  }
  return (
    <TableBody>
      {table.getRowModel().rows.map((row) => (
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
                findDataTableColumn(columns, cell.column.id)?.cellClassName,
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          ))}
          {showColumnVisibility ? <TableCell className={cn(compact && "py-0")} /> : null}
        </TableRow>
      ))}
    </TableBody>
  );
}
