import type { ContactProfile } from "@openengage/core/contacts";

export type ContactTimelineEntry = {
  id: string;
  type: string;
  description: string;
  at: string;
  tone: "indigo" | "emerald" | "amber";
};

export function buildContactTimeline(
  profile: Pick<ContactProfile, "timeline" | "scoreEvents">,
): ContactTimelineEntry[] {
  return [
    ...profile.timeline.map(
      (event): ContactTimelineEntry => ({
        id: event.id,
        type: event.type,
        description: event.resourceType
          ? `${event.resourceType}${event.resourceId ? ` · ${event.resourceId}` : ""}`
          : "Contact activity",
        at: event.occurredAt,
        tone: "indigo",
      }),
    ),
    ...profile.scoreEvents.map(
      (event): ContactTimelineEntry => ({
        id: event.id,
        type: event.delta > 0 ? `スコア +${event.delta}` : `スコア ${event.delta}`,
        description: event.reason,
        at: event.createdAt,
        tone: event.delta > 0 ? "emerald" : "amber",
      }),
    ),
  ].sort((left, right) => right.at.localeCompare(left.at));
}
