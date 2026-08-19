import { computeDueAt, outgoingEdges } from "@openengage/core/automations";
import {
  type AutomationDefinition,
  type AutomationEdge,
  type AutomationNode,
} from "@openengage/core/automations";
import {
  AutomationActionRepository,
  AutomationEngineRepository,
  AutomationJobRecoveryRepository,
  AUTOMATION_MAX_STARTS,
  createDatabase,
  type AutomationContactColumn,
  type AutomationJobRow,
  type OpenEngageDatabase,
} from "@openengage/database";

import { PermanentChannelError } from "../channels";
import { recordContactEvent } from "../contacts/event-service";
import { type RuntimeEnv } from "../env";
import { createEmailDelivery, createWebhookDelivery } from "../messaging/delivery-worker";
import { primitiveString } from "../platform/values";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";

export async function processAutomationJob(
  jobId: string,
  leaseId: string,
  env: RuntimeEnv,
): Promise<void> {
  const database = createDatabase(env.DB);
  const engine = new AutomationEngineRepository(database);
  const recovery = new AutomationJobRecoveryRepository(database);
  const job = await engine.findJobForProcessing(jobId, leaseId);
  if (!job) return;
  const started = await engine.startLeasedJob(jobId, leaseId, new Date().toISOString());
  if (!started && job.status !== "running") {
    if (job.attempts >= AUTOMATION_MAX_STARTS) {
      await recovery.failJobAndEnrollmentForLease(
        job.id,
        leaseId,
        "Automation attempts exhausted",
        new Date().toISOString(),
      );
    }
    return;
  }

  try {
    const definition = job.graph;
    const node = definition.nodes.find((candidate) => candidate.id === job.nodeId);
    if (!node) throw new PermanentChannelError(`Automation node ${job.nodeId} is missing`);
    const result = await executeNode(node, definition, job, env, database, engine);
    if (result.waitUntil) {
      await engine.parkJobUntil(job.id, leaseId, {
        dueAt: result.waitUntil,
        payload: JSON.stringify({ waiting: true }),
        now: new Date().toISOString(),
        waitEventType: result.waitEventType ?? null,
        waitResourceId: result.waitResourceId ?? null,
        waitStartedAt: result.waitStartedAt ?? null,
      });
      return;
    }
    await finishNode(job, leaseId, definition, result.branch, engine);
  } catch (error) {
    const failure = await recovery.recordJobFailure(
      job.id,
      leaseId,
      error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      new Date().toISOString(),
      error instanceof PermanentChannelError,
    );
    if (failure === "retry" || error instanceof PermanentChannelError) throw error;
  }
}

export async function executeNode(
  node: AutomationNode,
  definition: AutomationDefinition,
  job: AutomationJobRow,
  env: RuntimeEnv,
  database: OpenEngageDatabase,
  engine: AutomationEngineRepository,
): Promise<{
  branch?: AutomationEdge["branch"];
  waitUntil?: string;
  waitEventType?: string;
  waitResourceId?: string | null;
  waitStartedAt?: string;
}> {
  if (node.type === "source") return { branch: "next" };
  if (node.type === "delay") {
    return {
      branch: "next",
      waitUntil: computeDueAt(node, new Date(), definition.timezone).toISOString(),
    };
  }
  if (node.type === "condition") {
    return { branch: (await evaluateCondition(node, job, engine)) ? "yes" : "no" };
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
    const found = await engine.hasContactEventSince(
      job.workspaceId,
      job.contactId,
      eventType,
      job.createdAt,
      node.config.resourceId ?? null,
    );
    if (found) return { branch: "yes" };
    const deadline = new Date(
      new Date(job.createdAt).getTime() + node.config.withinMinutes * 60_000,
    );
    if (job.payload["waiting"] === true || Date.now() >= deadline.getTime()) {
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
  const now = new Date().toISOString();
  switch (action.action) {
    case "send_email":
      await createEmailDelivery(action, job, env, database);
      break;
    case "send_webhook":
      await createWebhookDelivery(action.endpointId, job, env, database);
      break;
    case "add_tag":
      await engine.addContactTag(job.workspaceId, job.contactId, action.tagId, now);
      break;
    case "remove_tag":
      await engine.removeContactTag(job.workspaceId, job.contactId, action.tagId);
      break;
    case "add_segment":
      if (
        await engine.addAutomationSegmentMembership(
          job.workspaceId,
          action.segmentId,
          job.contactId,
          now,
        )
      ) {
        await recordContactEvent(database, {
          workspaceId: job.workspaceId,
          contactId: job.contactId,
          type: "segment_joined",
          resourceType: "segment",
          resourceId: action.segmentId,
          queue: env.JOBS_QUEUE,
        });
      }
      break;
    case "remove_segment":
      await engine.removeSegmentMembership(job.workspaceId, action.segmentId, job.contactId);
      break;
    case "change_score":
      await new AutomationActionRepository(database).adjustContactScoreForJob(
        job,
        action.amount,
        now,
      );
      break;
    case "update_field":
      await updateContactField(job, action.field, action.value, engine);
      break;
  }
  await enqueueSegmentContactReconciliation(env.JOBS_QUEUE, job.workspaceId, [job.contactId]);
  return { branch: "next" };
}

export async function finishNode(
  job: AutomationJobRow,
  leaseId: string,
  definition: AutomationDefinition,
  branch: AutomationEdge["branch"] | undefined,
  engine: AutomationEngineRepository,
): Promise<void> {
  const next = outgoingEdges(definition, job.nodeId, branch ?? "next")[0];
  const now = new Date().toISOString();
  if (!next) {
    await engine.completeJobClosingEnrollment(job, leaseId, now);
    return;
  }
  await engine.completeJobAdvancingEnrollment(job, leaseId, next.target, now);
}

export async function evaluateCondition(
  node: Extract<AutomationNode, { type: "condition" }>,
  job: AutomationJobRow,
  engine: AutomationEngineRepository,
): Promise<boolean> {
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
    const tagged = await engine.contactHasTagWithSlug(
      job.workspaceId,
      job.contactId,
      String(node.config.value ?? ""),
    );
    return compare(tagged, node.config.operator, true);
  }
  return compare(fieldMap[node.config.field], node.config.operator, node.config.value);
}

export function compare(left: unknown, operator: string, right: unknown): boolean {
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

export async function updateContactField(
  job: AutomationJobRow,
  field: string,
  value: unknown,
  engine: AutomationEngineRepository,
): Promise<void> {
  const columns: Record<string, AutomationContactColumn> = {
    first_name: "first_name",
    last_name: "last_name",
    phone: "phone",
    stage: "stage",
    external_id: "external_id",
  };
  const column = columns[field];
  if (column) {
    await engine.updateContactColumn(
      job.workspaceId,
      job.contactId,
      column,
      primitiveString(value),
      new Date().toISOString(),
    );
    return;
  }
  if (!/^[A-Za-z0-9_.-]{1,191}$/.test(field)) {
    throw new PermanentChannelError("Invalid custom field key");
  }
  const fields = { ...job.customFields };
  fields[field] = value;
  await engine.replaceContactCustomFields(
    job.workspaceId,
    job.contactId,
    JSON.stringify(fields),
    new Date().toISOString(),
  );
}
