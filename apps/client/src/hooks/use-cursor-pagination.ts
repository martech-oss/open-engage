import { useState } from "react";

type CursorPaginationState = {
  key: string;
  cursor: string | undefined;
  history: Array<string | undefined>;
};

function firstPage(key: string): CursorPaginationState {
  return { key, cursor: undefined, history: [] };
}

/**
 * Local cursor navigation keyed to the query that owns the result set. A key
 * change exposes the first page during that render, before effects can run.
 */
export function useCursorPagination(resetKey: string) {
  const [stored, setStored] = useState<CursorPaginationState>(() => firstPage(resetKey));
  const current = stored.key === resetKey ? stored : firstPage(resetKey);

  function goToNextPage(nextCursor: string | undefined): void {
    setStored((previous) => {
      const normalized = previous.key === resetKey ? previous : firstPage(resetKey);
      if (!nextCursor || nextCursor === normalized.cursor) return normalized;
      return {
        key: resetKey,
        cursor: nextCursor,
        history: [...normalized.history, normalized.cursor],
      };
    });
  }

  function goToPreviousPage(): void {
    setStored((previous) => {
      const normalized = previous.key === resetKey ? previous : firstPage(resetKey);
      if (normalized.history.length === 0) return normalized;
      return {
        key: resetKey,
        cursor: normalized.history.at(-1),
        history: normalized.history.slice(0, -1),
      };
    });
  }

  return {
    cursor: current.cursor,
    pageIndex: current.history.length,
    hasPreviousPage: current.history.length > 0,
    goToNextPage,
    goToPreviousPage,
  };
}
