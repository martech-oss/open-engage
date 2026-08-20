import { useCallback, useState } from "react";

import type { BulkAction } from "../contact-bits";

type ContactSelectionState = {
  key: string;
  ids: Set<string>;
  bulkAction: BulkAction | null;
  bulkResourceId: string;
};

function emptySelection(key: string): ContactSelectionState {
  return { key, ids: new Set(), bulkAction: null, bulkResourceId: "" };
}

export function useKeyedContactSelection(key: string) {
  const [storedSelection, setSelection] = useState<ContactSelectionState>(() =>
    emptySelection(key),
  );
  let selection = storedSelection;
  if (storedSelection.key !== key) {
    selection = emptySelection(key);
    setSelection(selection);
  }
  const setSelected = useCallback(
    (ids: Set<string>) =>
      setSelection((previous) => {
        const current = previous.key === key ? previous : emptySelection(key);
        return ids.size === 0 ? emptySelection(key) : { ...current, ids };
      }),
    [key],
  );
  const setBulkAction = useCallback(
    (bulkAction: BulkAction | null) =>
      setSelection((previous) => ({
        ...(previous.key === key ? previous : emptySelection(key)),
        bulkAction,
      })),
    [key],
  );
  const setBulkResourceId = useCallback(
    (bulkResourceId: string) =>
      setSelection((previous) => ({
        ...(previous.key === key ? previous : emptySelection(key)),
        bulkResourceId,
      })),
    [key],
  );
  return {
    selected: selection.ids,
    setSelected,
    bulkAction: selection.bulkAction,
    setBulkAction,
    bulkResourceId: selection.bulkResourceId,
    setBulkResourceId,
  };
}
