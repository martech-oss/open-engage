const DAY_MS = 86_400_000;
export function remainingContribution(
  initial: number,
  decayDays: number | null,
  occurredAt: string,
  now: Date,
): number {
  if (decayDays === null) return initial;
  const elapsed = Math.max(0, Math.floor((now.getTime() - Date.parse(occurredAt)) / DAY_MS));
  return Math.floor((initial * Math.max(0, decayDays - elapsed)) / decayDays);
}
export function nextContributionDecay(
  decayDays: number | null,
  occurredAt: string,
  now: Date,
): string | null {
  if (decayDays === null) return null;
  const elapsed = Math.max(0, Math.floor((now.getTime() - Date.parse(occurredAt)) / DAY_MS));
  return elapsed >= decayDays
    ? null
    : new Date(Date.parse(occurredAt) + (elapsed + 1) * DAY_MS).toISOString();
}
