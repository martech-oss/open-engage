import { normalizeSlug } from "@openengage/core/shared";

import { randomIdentifier } from "../platform/crypto";

export async function availableSlug(
  name: string,
  fallback: string,
  isAvailable: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = normalizeSlug(name, { fallback });
  for (const suffix of ["", "-2", "-3"] as const) {
    const candidate = appendSuffix(base, suffix);
    if (await isAvailable(candidate)) return candidate;
  }
  for (;;) {
    const candidate = appendSuffix(base, `-${randomIdentifier(8).toLowerCase()}`);
    if (await isAvailable(candidate)) return candidate;
  }
}

function appendSuffix(base: string, suffix: string): string {
  return `${base.slice(0, 80 - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
