import {
  computeDueAt,
  automationNumber,
  type AutomationDefinition,
  type AutomationNode,
  type AutomationEdge,
} from "@openengage/core/automations";
import type { AutomationJobRow } from "@openengage/database/automations";

import { PermanentChannelError } from "../channels";
import { primitiveString } from "../platform/values";
import type { AutomationNodeDependencies } from "./execution-dependencies";

export async function executeNode(
  node: AutomationNode,
  definition: AutomationDefinition,
  job: AutomationJobRow,
  leaseId: string,
  dependencies: AutomationNodeDependencies,
): Promise<{
  parked?: boolean;
  branch?: AutomationEdge["branch"];
  waitUntil?: string;
  waitEventType?: string;
  waitResourceId?: string | null;
  waitStartedAt?: string;
}> {
  const { decisions, contactConditions, calls, clock } = dependencies;
  if (node.type === "source") return { branch: "next" };
  if (node.type === "delay") {
    if (job.payload["waiting"] === true) return { branch: "next" };
    return {
      branch: "next",
      waitUntil: computeDueAt(node, clock(), definition.timezone).toISOString(),
    };
  }
  if (node.type === "condition") {
    return {
      branch: await decisions.captureCondition(
        job,
        leaseId,
        "filter" in node.config
          ? node.config.filter
          : await evaluateCondition(node, job, contactConditions),
      ),
    };
  }
  if (node.type === "decision") {
    const eventType = {
      opened: "email_opened",
      clicked: "email_clicked",
      replied: "email_replied",
      page_viewed: "page_viewed",
      form_submitted: "form_submitted",
      custom_event: "custom_event",
    }[node.config.event];
    const found = await decisions.hasContactEventSince(
      job.workspaceId,
      job.contactId,
      eventType,
      job.createdAt,
      node.config.resourceId ?? null,
    );
    if (found) return { branch: "yes" };
    const deadline = new Date(
      new Date(job.createdAt).getTime() + automationNumber(node.config.withinMinutes) * 60_000,
    );
    if (job.payload["waiting"] === true || clock().getTime() >= deadline.getTime()) {
      return { branch: "timeout" };
    }
    return {
      waitUntil: deadline.toISOString(),
      waitEventType: eventType,
      waitResourceId: node.config.resourceId ?? null,
      waitStartedAt: job.createdAt,
    };
  }

  const action = node.config;
  if (action.action === "call_automation") {
    const child = await calls.startChild(job, leaseId, action.mode, clock().toISOString());
    if (child.parked) return { parked: true };
    if (action.mode === "await" && child.status !== "completed")
      throw new PermanentChannelError(`Child automation ${child.id} ${child.status}`);
    return { branch: "next" };
  }
  await dependencies.executeAction(action, job, leaseId);
  return { branch: "next" };
}

async function evaluateCondition(
  node: Extract<AutomationNode, { type: "condition" }>,
  job: AutomationJobRow,
  contactActions: AutomationNodeDependencies["contactConditions"],
): Promise<boolean> {
  if ("filter" in node.config) throw new Error("Rich conditions require durable evaluation");
  const fieldMap: Record<string, unknown> = {
    email: job.contactEmail,
    first_name: job.firstName,
    last_name: job.lastName,
    phone: job.phone,
    stage: job.stage,
    score: job.score,
    ...job.customFields,
  };
  if (node.config.field === "tag") {
    const tagged = await contactActions.contactHasTagWithSlug(
      job.workspaceId,
      job.contactId,
      String(node.config.value ?? ""),
    );
    return compare(tagged, node.config.operator, true);
  }
  return compare(fieldMap[node.config.field], node.config.operator, node.config.value);
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  if (operator === "exists") return left !== null && left !== undefined;
  if (operator === "not_exists") return left === null || left === undefined;
  if (operator === "eq") return primitiveString(left) === primitiveString(right);
  if (operator === "neq") return primitiveString(left) !== primitiveString(right);
  if (operator === "contains") return primitiveString(left).includes(primitiveString(right));
  if (operator === "starts_with") return primitiveString(left).startsWith(primitiveString(right));
  if (operator === "in") {
    return Array.isArray(right) && right.some((value) => String(value) === String(left));
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  if (operator === "gt") return leftNumber > rightNumber;
  if (operator === "gte") return leftNumber >= rightNumber;
  if (operator === "lt") return leftNumber < rightNumber;
  if (operator === "lte") return leftNumber <= rightNumber;
  return false;
}
