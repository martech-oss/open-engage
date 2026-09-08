import { describe, expect, it } from "vitest";

import * as scheduling from "./schedule";
import { automationDefinitionSchema, automationScheduleSchema } from "./schema";
const source = (config: unknown) => ({
  name: "Batch",
  nodes: [{ id: "source", type: "source", position: { x: 0, y: 0 }, config }],
  edges: [],
});
describe("automation execution definitions", () => {
  it("accepts scheduled filter runs with cooldown and explicit variable context", () => {
    const parsed = automationDefinitionSchema.safeParse({
      ...source({
        source: "batch",
        audience: {
          kind: "filter",
          filter: { kind: "condition", field: "score", operator: "gte", value: 10 },
        },
        schedule: { kind: "monthly", day: 31, hour: 9, minute: 0 },
        reentry: "cooldown",
        cooldownMinutes: 60,
      }),
      variableProjectId: "project",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveProperty("variableProjectId", "project");
  });
  it("rejects cooldown without a positive duration", () =>
    expect(
      automationDefinitionSchema.safeParse(
        source({ source: "api_event", eventName: "ping", reentry: "cooldown" }),
      ).success,
    ).toBe(false));
  it("accepts shared filter conditions and callable actions", () => {
    const graph = {
      ...source({ source: "callable", reentry: "every_time" }),
      nodes: [
        ...source({ source: "callable", reentry: "every_time" }).nodes,
        {
          id: "condition",
          type: "condition",
          position: { x: 1, y: 0 },
          config: { filter: { kind: "condition", field: "score", operator: "gte", value: 100 } },
        },
        {
          id: "child",
          type: "action",
          position: { x: 2, y: 0 },
          config: { action: "call_automation", automationId: "child", mode: "await" },
        },
      ],
    };
    expect(automationDefinitionSchema.safeParse(graph).success).toBe(true);
  });
});
describe("calendar batch slots", () => {
  const slot = (schedule: unknown, after: string, through: string, timezone = "UTC") => {
    return scheduling
      .latestAutomationSlot(
        automationScheduleSchema.parse(schedule),
        new Date(after),
        new Date(through),
        timezone,
      )
      ?.toISOString();
  };
  it("clamps month end and catches up only the latest slot", () =>
    expect(
      slot(
        { kind: "monthly", day: 31, hour: 9, minute: 0 },
        "2026-01-01T00:00:00Z",
        "2026-03-01T00:00:00Z",
      ),
    ).toBe("2026-02-28T09:00:00.000Z"));
  it("skips nonexistent spring wall-clock times", () =>
    expect(
      slot(
        { kind: "daily", hour: 2, minute: 30 },
        "2026-03-07T08:00:00Z",
        "2026-03-08T23:00:00Z",
        "America/New_York",
      ),
    ).toBeUndefined());
  it("uses only first repeated autumn wall-clock time", () => {
    expect(
      slot(
        { kind: "daily", hour: 1, minute: 30 },
        "2026-10-31T08:00:00Z",
        "2026-11-01T08:00:00Z",
        "America/New_York",
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(
      slot(
        { kind: "daily", hour: 1, minute: 30 },
        "2026-11-01T05:30:00Z",
        "2026-11-01T08:00:00Z",
        "America/New_York",
      ),
    ).toBeUndefined();
  });
});

it("moves a delay after business hours to the next allowed local window across DST", () => {
  const node = {
    id: "delay",
    type: "delay" as const,
    position: { x: 0, y: 0 },
    config: {
      mode: "window" as const,
      minutes: 1,
      weekdays: [1, 2, 3, 4, 5],
      startHour: 9,
      endHour: 17,
    },
  };
  expect(
    scheduling
      .computeDueAt(node, new Date("2026-03-06T23:00:00.000Z"), "America/New_York")
      .toISOString(),
  ).toBe("2026-03-09T13:00:00.000Z");
});
