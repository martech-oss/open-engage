import { describe, expect, it, vi } from "vitest";

import {
  archiveWebsiteResource,
  summarizeCustomRedirects,
  summarizeLandingPages,
  summarizeSignupForms,
  summarizeSiteMessages,
} from "./resource-model";

describe("website resource summaries", () => {
  it("derives form totals from the complete loader result", () => {
    expect(
      summarizeSignupForms([
        { status: "published", submissionCount: 4 },
        { status: "draft", submissionCount: 7 },
      ]),
    ).toEqual({ total: 2, published: 1, submissions: 11 });
  });

  it("derives the maximum landing-page version", () => {
    expect(
      summarizeLandingPages([
        { status: "draft", version: 2 },
        { status: "published", version: 5 },
        { status: "published", version: 3 },
      ]),
    ).toEqual({ total: 3, published: 2, latestVersion: 5 });
  });

  it("does not report a click rate without impressions", () => {
    expect(
      summarizeSiteMessages([{ status: "published", impressionCount: 0, clickCount: 2 }]),
    ).toEqual({ total: 1, published: 1, impressions: 0, clicks: 2, clickRate: 0 });
  });

  it("totals redirect clicks", () => {
    expect(summarizeCustomRedirects([{ clickCount: 3 }, { clickCount: 8 }])).toEqual({
      total: 2,
      clicks: 11,
    });
  });
});

describe("archiveWebsiteResource", () => {
  it("announces success only after the archive completes", async () => {
    const events: string[] = [];
    await archiveWebsiteResource({
      archive: async () => events.push("archive"),
      onSuccess: () => events.push("success"),
      onError: () => events.push("error"),
    });
    expect(events).toEqual(["archive", "success"]);
  });

  it("reports a useful error and does not announce success", async () => {
    const onSuccess = vi.fn<() => void>();
    const onError = vi.fn<(message: string) => void>();
    await archiveWebsiteResource({
      archive: async () => {
        throw new Error("network unavailable");
      },
      onSuccess,
      onError,
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("network unavailable");
  });
});
