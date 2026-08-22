import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import type { DataTablePagination } from "./data-table-types";

export function DataTableFooter({ pagination }: { pagination: DataTablePagination }): ReactNode {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5">
      {pagination.rangeLabel ? (
        <span className="mr-auto text-xs text-muted-foreground">{pagination.rangeLabel}</span>
      ) : null}
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
    </div>
  );
}
