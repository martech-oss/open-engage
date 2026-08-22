import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  headClassName?: string;
  cellClassName?: string;
  /** Client-side sort for complete lists only. Ignored when pagination is present. */
  sortValue?: (row: T) => string | number;
  label?: string;
  enableHiding?: boolean;
}

export interface DataTablePagination {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNext: () => void;
  onPrevious: () => void;
  rangeLabel?: ReactNode;
}

export type DataTableProps<T> = {
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
  containerClassName?: string;
  compact?: boolean;
  pagination?: DataTablePagination;
  showColumnVisibility?: boolean;
};

export function findDataTableColumn<T>(
  columns: DataTableColumn<T>[],
  key: string,
): DataTableColumn<T> | undefined {
  return columns.find((column) => column.key === key);
}
