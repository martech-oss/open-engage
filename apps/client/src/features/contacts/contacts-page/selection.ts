import { useCallback, useState } from "react";

export function useKeyedContactSelection(key: string) {
  const [storedSelection, setSelection] = useState<{ key: string; ids: Set<string> }>(() => ({
    key,
    ids: new Set(),
  }));
  let selection = storedSelection;
  if (storedSelection.key !== key) {
    selection = { key, ids: new Set() };
    setSelection(selection);
  }
  const setSelected = useCallback((ids: Set<string>) => setSelection({ key, ids }), [key]);
  return { selected: selection.ids, setSelected };
}
