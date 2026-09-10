import { describe, expect, it } from "vitest";

import { jobsQueueMessageSchema } from "./queues";

describe("jobs queue messages", () => {
  it.each([
    { kind: "automation_job", jobId: "job-1", leaseId: "lease-1" },
    { kind: "contact_event", eventId: "event-1" },
    { kind: "contact_import", importJobId: "import-1", part: 0, totalParts: 2 },
    { kind: "contact_export", exportJobId: "export-1" },
    { kind: "scoring_decay", now: "2026-09-10T00:00:00.000Z" },
  ])("accepts $kind", (message) => {
    expect(jobsQueueMessageSchema.parse(message)).toEqual(message);
  });

  it.each([{ kind: "scoring_decay" }, { kind: "scoring_decay", now: "invalid" }])(
    "rejects decay work without a valid cutoff: $now",
    (message) => {
      expect(jobsQueueMessageSchema.safeParse(message).success).toBe(false);
    },
  );

  it.each([
    { kind: "campaign_job", jobId: "job-1", leaseId: "lease-1" },
    { kind: "broadcast_batch", broadcastId: "broadcast-1" },
  ])("rejects removed message kind $kind", (message) => {
    expect(jobsQueueMessageSchema.safeParse(message).success).toBe(false);
  });
});
