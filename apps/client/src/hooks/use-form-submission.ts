import { useState } from "react";

import { getErrorMessage } from "@/lib/errors";

/**
 * Wraps a form's submit action with the busy/error state every dialog form in
 * this app already needed by hand. `run` swallows and stringifies the error so
 * callers can render it; it never rethrows.
 */
export function useFormSubmission(defaultErrorMessage: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (caught) {
      setError(getErrorMessage(caught, defaultErrorMessage));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run, setError };
}
