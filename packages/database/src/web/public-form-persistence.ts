export function isContactEmailConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed:\s*contacts\.workspace_id,\s*contacts\.email/i.test(message);
}
