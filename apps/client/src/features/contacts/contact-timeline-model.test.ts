import { describe, expect, it } from "vitest";

import { buildContactTimeline } from "./contact-timeline-model";

describe("buildContactTimeline", () => {
  it("merges contact and score events in descending timestamp order", () => {
    const entries = buildContactTimeline({
      timeline: [
        {
          id: "activity-1",
          type: "email_opened",
          resourceType: "email",
          resourceId: "email-1",
          properties: {},
          occurredAt: "2026-08-23T09:00:00.000Z",
        },
      ],
      scoreEvents: [
        {
          id: "score-1",
          delta: 5,
          reason: "Pricing visit",
          createdAt: "2026-08-23T10:00:00.000Z",
        },
      ],
    });

    expect(entries).toEqual([
      {
        id: "score-1",
        type: "スコア +5",
        description: "Pricing visit",
        at: "2026-08-23T10:00:00.000Z",
        tone: "emerald",
      },
      {
        id: "activity-1",
        type: "email_opened",
        description: "email · email-1",
        at: "2026-08-23T09:00:00.000Z",
        tone: "indigo",
      },
    ]);
  });
});
