export function isStaleTimestamp(timestamp: string): boolean {
  const seconds = Number(timestamp);
  return !Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300;
}
