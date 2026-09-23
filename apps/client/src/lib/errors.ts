/** A user-facing message for a caught error, or `fallback` when it carries none. */
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
