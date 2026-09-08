import { describe, expect, it } from "vitest";

import { PermanentChannelError } from "../channels";
import { dispatchAutomationAction, type AutomationActionExecutorRegistry } from "./action-dispatch";

type TestContext = { calls: string[] };

function registry(): AutomationActionExecutorRegistry<TestContext> {
  return {
    send_email: async (action, context) => {
      context.calls.push(`email:${action.templateId}`);
    },
    send_webhook: async (action, context) => {
      context.calls.push(`webhook:${action.endpointId}`);
    },
    add_tag: async (action, context) => {
      context.calls.push(`add-tag:${action.tagId}`);
    },
    remove_tag: async (action, context) => {
      context.calls.push(`remove-tag:${action.tagId}`);
    },
    add_segment: async (action, context) => {
      context.calls.push(`add-segment:${action.segmentId}`);
    },
    remove_segment: async (action, context) => {
      context.calls.push(`remove-segment:${action.segmentId}`);
    },
    call_automation: async () => {},
    upsert_project_member: async () => {},
    handoff_to_sales: async () => {},
    change_score: async (action, context) => {
      context.calls.push(`score:${JSON.stringify(action.amount)}`);
    },
    update_field: async (action, context) => {
      context.calls.push(`field:${action.field}=${JSON.stringify(action.value)}`);
    },
  };
}

describe("dispatchAutomationAction", () => {
  it("dispatches to the executor keyed by action kind", async () => {
    const context: TestContext = { calls: [] };

    await dispatchAutomationAction(registry(), { action: "change_score", amount: 7 }, context);

    expect(context.calls).toEqual(["score:7"]);
  });

  it("treats an unknown persisted action as a permanent error", async () => {
    const context: TestContext = { calls: [] };

    await expect(
      dispatchAutomationAction(registry(), { action: "future_action" } as never, context),
    ).rejects.toBeInstanceOf(PermanentChannelError);
    expect(context.calls).toEqual([]);
  });
});
