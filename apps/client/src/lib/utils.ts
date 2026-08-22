import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(
  value: string,
  options?: { maxLength?: number; fallback?: string },
): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  const trimmed = options?.maxLength ? normalized.slice(0, options.maxLength) : normalized;

  return trimmed || (options?.fallback ?? "resource");
}
