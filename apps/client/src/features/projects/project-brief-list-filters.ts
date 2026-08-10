import type {
  MarketingMotion,
  ProjectBriefStatus,
  ProjectBriefSummary,
} from "@openengage/core/projects";

export type ProjectBriefSearch = {
  status: "all" | ProjectBriefStatus;
  motion: "all" | MarketingMotion;
  owner: string;
  overdue: boolean;
};

export const projectBriefSearchDefaults: ProjectBriefSearch = {
  status: "all",
  motion: "all",
  owner: "all",
  overdue: false,
};

const STATUSES = new Set(["draft", "pending_approval", "approved", "completed"]);
const MOTIONS = new Set([
  "acquisition",
  "onboarding",
  "engagement",
  "retention",
  "reactivation",
  "measurement",
]);

export function parseProjectBriefSearch(search: Record<string, unknown>): ProjectBriefSearch {
  const status =
    typeof search.status === "string" && STATUSES.has(search.status)
      ? (search.status as ProjectBriefStatus)
      : "all";
  const motion =
    typeof search.motion === "string" && MOTIONS.has(search.motion)
      ? (search.motion as MarketingMotion)
      : "all";
  return {
    status,
    motion,
    owner: typeof search.owner === "string" && search.owner ? search.owner : "all",
    overdue: search.overdue === true || search.overdue === "true",
  };
}

export function isReviewOverdue(
  brief: Pick<ProjectBriefSummary, "reviewAt" | "status">,
  now = Date.now(),
): boolean {
  return brief.status === "approved" && new Date(brief.reviewAt).getTime() < now;
}

export function matchesProjectBriefSearch(
  brief: ProjectBriefSummary,
  search: ProjectBriefSearch,
  now = Date.now(),
): boolean {
  return (
    (search.status === "all" || brief.status === search.status) &&
    (search.motion === "all" || brief.primaryMotion === search.motion) &&
    (search.owner === "all" || brief.ownerUserId === search.owner) &&
    (!search.overdue || isReviewOverdue(brief, now))
  );
}
