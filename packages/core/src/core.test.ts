import { describe, expect, it } from "vitest";

import type { AutomationDefinition } from "./automations/schema.js";
import {
  canTransitionJob,
  compileSegmentFilter,
  evaluateSendEligibility,
  retryDelaySeconds,
  validateAutomation,
} from "./index.js";

describe("automation validation", () => {
  it("rejects cycles", () => {
    const definition: AutomationDefinition = {
      name: "bad",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "contact_created", reentry: "once" },
        },
        {
          id: "send",
          type: "action",
          position: { x: 0, y: 100 },
          config: {
            action: "send_email",
            templateId: "template",
          },
        },
      ],
      edges: [
        { id: "one", source: "source", target: "send", branch: "next" },
        { id: "two", source: "send", target: "source", branch: "next" },
      ],
    };
    expect(validateAutomation(definition).map((issue) => issue.code)).toContain("cycle");
  });

  it("accepts a published email template action", () => {
    const definition: AutomationDefinition = {
      name: "transactional welcome flow",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "contact_created", reentry: "once" },
        },
        {
          id: "send",
          type: "action",
          position: { x: 0, y: 100 },
          config: {
            action: "send_email",
            templateId: "template",
          },
        },
      ],
      edges: [{ id: "one", source: "source", target: "send", branch: "next" }],
    };
    expect(validateAutomation(definition)).toEqual([]);
  });
});

describe("segment compiler", () => {
  it("binds values and never interpolates user input", () => {
    const result = compileSegmentFilter("workspace", {
      kind: "group",
      combinator: "and",
      children: [
        {
          kind: "condition",
          field: "email",
          operator: "contains",
          value: "' OR 1=1 --",
        },
        {
          kind: "condition",
          field: "score",
          operator: "gte",
          value: 10,
        },
      ],
    });
    expect(result.sql).not.toContain("' OR 1=1");
    expect(result.params).toEqual(["workspace", "%' OR 1=1 --%", 10]);
  });

  it("rejects operators that are invalid for the selected field", () => {
    expect(() =>
      compileSegmentFilter("workspace", {
        kind: "condition",
        field: "score",
        operator: "contains",
        value: "10",
      }),
    ).toThrow("contains is not supported for score");
  });

  it("requires keys for keyed segment fields", () => {
    expect(() =>
      compileSegmentFilter("workspace", {
        kind: "condition",
        field: "event",
        operator: "eq",
        value: null,
      }),
    ).toThrow("event requires key");
  });

  it("matches system and named custom events without interpolating the event name", () => {
    const result = compileSegmentFilter("workspace", {
      kind: "condition",
      field: "event",
      key: "trial_activated",
      operator: "exists",
      value: null,
    });

    expect(result.sql).toContain("ce.resource_id = ?");
    expect(result.params).toEqual(["workspace", "trial_activated", "trial_activated"]);
  });
});

describe("delivery safeguards", () => {
  it("blocks marketing after unsubscribe but permits transactional mail", () => {
    const snapshot = {
      globalStatus: "unsubscribed" as const,
      suppressed: false,
      frequency: { sentInWindow: 0, limit: null },
    };
    expect(evaluateSendEligibility("marketing", snapshot)).toEqual({
      allowed: false,
      reason: "global_unsubscribed",
    });
    expect(evaluateSendEligibility("transactional", snapshot)).toEqual({ allowed: true });
  });

  it("blocks every delivery to an archived contact", () => {
    const snapshot = {
      contactStatus: "archived" as const,
      globalStatus: "subscribed" as const,
      suppressed: false,
      frequency: { sentInWindow: 0, limit: null },
    };
    expect(evaluateSendEligibility("marketing", snapshot)).toEqual({
      allowed: false,
      reason: "contact_archived",
    });
    expect(evaluateSendEligibility("transactional", snapshot)).toEqual({
      allowed: false,
      reason: "contact_archived",
    });
  });

  it("defines bounded retries and valid transitions", () => {
    expect(canTransitionJob("processing", "completed")).toBe(true);
    expect(canTransitionJob("completed", "pending")).toBe(false);
    expect(retryDelaySeconds(20)).toBe(3_600);
  });
});
