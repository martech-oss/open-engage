export function summarizeSignupForms(
  items: ReadonlyArray<{ status: string; submissionCount: number }>,
) {
  return {
    total: items.length,
    published: items.filter((item) => item.status === "published").length,
    submissions: items.reduce((total, item) => total + item.submissionCount, 0),
  };
}

export function summarizeLandingPages(
  items: ReadonlyArray<{ status: string; version: number | null | undefined }>,
) {
  return {
    total: items.length,
    published: items.filter((item) => item.status === "published").length,
    latestVersion: items.reduce((version, item) => Math.max(version, item.version ?? 0), 0),
  };
}

export function summarizeSiteMessages(
  items: ReadonlyArray<{ status: string; impressionCount: number; clickCount: number }>,
) {
  const impressions = items.reduce((total, item) => total + item.impressionCount, 0);
  const clicks = items.reduce((total, item) => total + item.clickCount, 0);
  return {
    total: items.length,
    published: items.filter((item) => item.status === "published").length,
    impressions,
    clicks,
    clickRate: impressions > 0 ? (clicks / impressions) * 100 : 0,
  };
}

export function summarizeCustomRedirects(items: ReadonlyArray<{ clickCount: number }>) {
  return {
    total: items.length,
    clicks: items.reduce((total, item) => total + item.clickCount, 0),
  };
}
