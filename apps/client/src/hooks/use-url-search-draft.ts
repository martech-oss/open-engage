import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import { useDebouncedSearch } from "./use-debounced-search";

/**
 * Draft text for a search box whose committed value lives in the URL. Typing
 * commits through `onCommit` after a debounce; a URL value this box did not
 * commit (back/forward, a link) replaces the draft. The owning page must not
 * be keyed on the query, or every commit remounts it and drops input focus.
 */
export function useUrlSearchDraft({
  value,
  onCommit,
  delayMs,
}: {
  value: string;
  onCommit: (value: string) => void;
  delayMs?: number;
}): [string, Dispatch<SetStateAction<string>>] {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setDraft(value);
  }, [value]);

  useDebouncedSearch({
    value: draft,
    ...(delayMs === undefined ? {} : { delayMs }),
    onCommit: (next) => {
      if (next === committed.current) return;
      committed.current = next;
      onCommit(next);
    },
  });

  return [draft, setDraft];
}
