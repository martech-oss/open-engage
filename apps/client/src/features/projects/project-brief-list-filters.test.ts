import { describe, expect, it } from "vitest";

import type { ProjectBriefSummary } from "@openengage/core/projects";

import {
  isReviewOverdue,
  matchesProjectBriefSearch,
  parseProjectBriefSearch,
  projectBriefSearchDefaults,
} from "./project-brief-list-filters";

const brief: ProjectBriefSummary = {
  id: "brief",
  name: "Onboarding",
  description: "",
  color: "#000000",
  itemCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  status: "approved",
  revision: 1,
  rowVersion: 1,
  primaryMotion: "onboarding",
  ownerUserId: "owner",
  ownerName: "Owner",
  approverUserId: "approver",
  approverName: "Approver",
  reviewAt: "2026-02-01T00:00:00.000Z",
};

describe("project brief list filters", () => {
  it("normalizes invalid URL values", () => {
    expect(parseProjectBriefSearch({ status: "bad", overdue: "true" })).toEqual({
      ...projectBriefSearchDefaults,
      overdue: true,
    });
  });

  it("uses a deterministic clock for overdue filtering", () => {
    expect(isReviewOverdue(brief, Date.parse("2026-03-01T00:00:00.000Z"))).toBe(true);
    expect(
      matchesProjectBriefSearch(
        brief,
        { ...projectBriefSearchDefaults, overdue: true },
        Date.parse("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
