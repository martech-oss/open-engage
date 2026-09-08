import { describe, expect, it } from "vitest";

import type { AutomationDefinition } from "@openengage/core/automations";

import { type AutomationResourceContext, validateAutomationResources } from "./resource-validation";

const context: AutomationResourceContext = {
  catalog: {
    timezone: "UTC",
    emailTemplates: [{ id: "email-1", name: "Welcome" }],
    forms: [{ id: "form-1", name: "Signup" }],
    segments: [
      { id: "static-1", name: "Customers" },
      { id: "dynamic-1", name: "Active users" },
    ],
    tags: [{ id: "tag-1", name: "VIP" }],
    webhookEndpoints: [{ id: "webhook-1", name: "CRM" }],
    subscriptionTopics: [{ id: "topic-1", name: "Product" }],
  },
  references: {
    emailTemplates: new Set(["email-1"]),
    forms: new Set(["form-1"]),
    segments: new Map([
      ["static-1", "static"],
      ["dynamic-1", "dynamic"],
    ]),
    tags: new Set(["tag-1"]),
    webhookEndpoints: new Set(["webhook-1"]),
    subscriptionTopics: new Set(["topic-1"]),
  },
};

function definition(action: AutomationDefinition["nodes"][number]): AutomationDefinition {
  return {
    name: "Resource test",
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "contact_created", reentry: "once" },
      },
      action,
    ],
    edges: [{ id: "edge", source: "source", target: action.id, branch: "next" }],
  };
}

describe("validateAutomationResources", () => {
  it("accepts available resource references", async () => {
    expect(
      await validateAutomationResources(
        definition({
          id: "email",
          type: "action",
          position: { x: 1, y: 1 },
          config: { action: "send_email", templateId: "email-1", topicId: "topic-1" },
        }),
        context,
      ),
    ).toEqual([]);
  });

  it("rejects missing resources", async () => {
    const issues = await validateAutomationResources(
      definition({
        id: "webhook",
        type: "action",
        position: { x: 1, y: 1 },
        config: { action: "send_webhook", endpointId: "missing" },
      }),
      context,
    );
    expect(issues).toMatchObject([
      { kind: "webhook_endpoint", resourceId: "missing", nodeId: "webhook" },
    ]);
  });

  it("rejects dynamic segments for membership actions", async () => {
    const issues = await validateAutomationResources(
      definition({
        id: "segment",
        type: "action",
        position: { x: 1, y: 1 },
        config: { action: "add_segment", segmentId: "dynamic-1" },
      }),
      context,
    );
    expect(issues[0]?.message).toContain("リストのみ");
  });
});
