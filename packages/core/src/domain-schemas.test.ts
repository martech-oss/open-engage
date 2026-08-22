import { describe, expect, it } from "vitest";

import { automationRowSchema } from "./automations/schema";
import { subscriptionTopicRowSchema } from "./consent/schema";
import { contactDataJobSchema, contactTimelineEventSchema } from "./contacts/schema";
import { deadLetterRowSchema } from "./platform/schema";
import { dashboardSchema } from "./reports/schema";

describe("canonical domain schemas", () => {
  it("round-trips contact jobs and rejects invalid counters", () => {
    const value = {
      id: "job-1",
      kind: "contact_export" as const,
      status: "completed",
      processed: 4,
      succeeded: 4,
      failed: 0,
      attempts: 1,
      error: null,
      errorManifestKey: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:01:00.000Z",
    };
    expect(contactDataJobSchema.parse(value)).toEqual(value);
    expect(() => contactDataJobSchema.parse({ ...value, failed: -1 })).toThrow();
  });

  it("validates moved entity DTOs at their boundaries", () => {
    expect(
      automationRowSchema.safeParse({
        id: "automation-1",
        name: "Welcome",
        description: "",
        status: "active",
        triggerSource: "contact_created",
        enrollmentCount: 1,
        activeCount: 1,
        completedCount: 0,
        updatedAt: "2026-08-05T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      subscriptionTopicRowSchema.safeParse({
        id: "topic-1",
        name: "News",
        slug: "news",
        description: "",
        isDefault: false,
        createdAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      contactTimelineEventSchema.safeParse({
        id: "event-1",
        type: "contact.created",
        resourceType: null,
        resourceId: null,
        properties: {},
        occurredAt: "2026-08-05T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed dashboard and dead-letter output", () => {
    expect(dashboardSchema.safeParse({ contacts: { count: -1 } }).success).toBe(false);
    expect(deadLetterRowSchema.safeParse({ id: "dead-letter" }).success).toBe(false);
  });
});
