export function readPath(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
