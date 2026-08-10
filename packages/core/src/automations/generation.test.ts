import { describe, expect, it } from "vitest";

import { automationGenerationResultSchema, generateAutomationInputSchema } from "./generation.js";

const definition = {
  name: "Welcome",
  description: "",
  timezone: "Asia/Tokyo",
  nodes: [
    {
      id: "source",
      type: "source" as const,
      position: { x: 0, y: 0 },
      config: { source: "contact_created" as const, reentry: "once" as const },
    },
  ],
  edges: [],
};

describe("automation generation schemas", () => {
  it("accepts create and refine requests", () => {
    expect(
      generateAutomationInputSchema.parse({ mode: "create", prompt: "登録後にメール" }),
    ).toEqual({ mode: "create", prompt: "登録後にメール" });
    expect(
      generateAutomationInputSchema.parse({
        mode: "refine",
        prompt: "待機を追加",
        currentDefinition: definition,
      }),
    ).toMatchObject({ mode: "refine", currentDefinition: definition });
  });

  it("requires a current definition in refine mode", () => {
    expect(
      generateAutomationInputSchema.safeParse({ mode: "refine", prompt: "待機を追加" }).success,
    ).toBe(false);
  });

  it("requires projectId and briefRevision together", () => {
    expect(
      generateAutomationInputSchema.safeParse({
        mode: "create",
        prompt: "登録後にメール",
        projectId: "project-id",
      }).success,
    ).toBe(false);
    expect(
      generateAutomationInputSchema.safeParse({
        mode: "create",
        prompt: "登録後にメール",
        projectId: "project-id",
        briefRevision: 2,
      }).success,
    ).toBe(true);
  });

  it("parses ready and needs-input results", () => {
    expect(
      automationGenerationResultSchema.parse({
        status: "ready",
        definition,
        summary: "新規登録フロー",
        assumptions: [],
        warnings: [],
      }).status,
    ).toBe("ready");

    const needsInput = {
      status: "needs_input" as const,
      summary: "メールを選択してください",
      plannedSteps: ["連絡先登録", "メール送信"],
      continuation: {
        summary: "メールを選択してください",
        plannedSteps: ["連絡先登録", "メール送信"],
        resources: [
          {
            requestId: "welcome-email",
            kind: "email_template" as const,
            label: "ウェルカムメール",
            reason: "送信内容が必要です",
            canOmit: false,
          },
        ],
      },
      resources: [
        {
          requestId: "welcome-email",
          kind: "email_template" as const,
          label: "ウェルカムメール",
          reason: "送信内容が必要です",
          canOmit: false,
          options: [{ id: "template-1", name: "Welcome" }],
        },
      ],
    };
    expect(automationGenerationResultSchema.parse(needsInput)).toEqual(needsInput);
  });
});
