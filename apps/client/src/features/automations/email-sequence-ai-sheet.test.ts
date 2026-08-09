import { describe, expect, it } from "vitest";

import type { EmailSequenceGenerationResult } from "@openengage/core/automations";

import { buildSequenceResolutions } from "./email-sequence-ai-sheet";

const result: Extract<EmailSequenceGenerationResult, { status: "needs_input" }> = {
  status: "needs_input",
  summary: "Additional information required",
  plannedSteps: ["Resolve resources"],
  continuation: {
    summary: "Additional information required",
    plannedSteps: ["Resolve resources"],
    requests: [
      {
        requestId: "topic",
        inputType: "resource",
        kind: "subscription_topic",
        label: "Topic",
        reason: "Marketing consent",
        required: true,
      },
      {
        requestId: "cta",
        inputType: "text",
        kind: "cta_url",
        label: "CTA",
        reason: "Destination",
        required: true,
      },
      {
        requestId: "offer",
        inputType: "text",
        kind: "offer",
        label: "Offer",
        reason: "Optional offer",
        required: false,
      },
    ],
  },
  requests: [
    {
      requestId: "topic",
      inputType: "resource",
      kind: "subscription_topic",
      label: "Topic",
      reason: "Marketing consent",
      required: true,
      options: [{ id: "topic-1", name: "Product education" }],
    },
    {
      requestId: "cta",
      inputType: "text",
      kind: "cta_url",
      label: "CTA",
      reason: "Destination",
      required: true,
      options: [],
    },
    {
      requestId: "offer",
      inputType: "text",
      kind: "offer",
      label: "Offer",
      reason: "Optional offer",
      required: false,
      options: [],
    },
  ],
};

describe("buildSequenceResolutions", () => {
  it("maps resource, text, and omission decisions", () => {
    expect(
      buildSequenceResolutions(result, {
        topic: "topic-1",
        cta: "https://example.com/start",
        offer: "__omit__",
      }),
    ).toEqual([
      { requestId: "topic", decision: "select", resourceId: "topic-1" },
      { requestId: "cta", decision: "provide", value: "https://example.com/start" },
      { requestId: "offer", decision: "omit" },
    ]);
  });
});
