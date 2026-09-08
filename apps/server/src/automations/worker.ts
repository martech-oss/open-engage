import {
  computeDueAt,
  outgoingEdges,
  automationNumber,
  automationString,
} from "@openengage/core/automations";
import {
  type AutomationDefinition,
  type AutomationEdge,
  type AutomationNode,
} from "@openengage/core/automations";
import {
  AutomationActionRepository,
  AutomationCallRepository,
  AutomationEngineRepository,
  AutomationJobRecoveryRepository,
  AUTOMATION_MAX_STARTS,
  type AutomationContactColumn,
  type AutomationJobRow,
} from "@openengage/database/automations";
import { createDatabase, type OpenEngageDatabase } from "@openengage/database/client";
import { SalesRepository } from "@openengage/database/deals";

import { PermanentChannelError } from "../channels";
import { type RuntimeEnv } from "../env";
import { createEmailDelivery, createWebhookDelivery } from "../messaging/delivery-worker";
import { primitiveString } from "../platform/values";
import { mutateProjectMember } from "../projects/program-service";
import { recordContactEvent } from "../runtime/contact-event-service";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";
import { dispatchAutomationAction, type AutomationActionExecutorRegistry } from "./action-dispatch";

interface AutomationActionExecutionContext {
  actionRepository: AutomationActionRepository;
  database: OpenEngageDatabase;
  engine: AutomationEngineRepository;
  env: RuntimeEnv;
  job: AutomationJobRow;
  leaseId: string;
  now: string;
}

const automationActionExecutors = {
  call_automation: async () => {
    throw new PermanentChannelError("Callable actions require parent/child execution");
  },
  upsert_project_member: async (action, context) => {
    await mutateProjectMember(
      context.database,
      { workspaceId: context.job.workspaceId },
      {
        projectId: action.projectId,
        contactId: context.job.contactId,
        ...(action.statusId ? { statusId: action.statusId } : {}),
        source: "automation",
        idempotencyKey: `automation:${context.job.enrollmentId}:${context.job.nodeId}`,
        authority: {
          jobId: context.job.id,
          leaseId: context.leaseId,
          enrollmentId: context.job.enrollmentId,
        },
      },
    );
  },
  handoff_to_sales: async (action, context) => {
    await new SalesRepository(context.database, {
      workspaceId: context.job.workspaceId,
    }).handoffForAutomation(
      {
        ...action,
        title: automationString(action.title),
        contactId: context.job.contactId,
        executionKey: `automation:${context.job.enrollmentId}:${context.job.nodeId}`,
      },
      context.job.id,
      context.leaseId,
    );
  },
  send_email: async (action, context) => {
    await createEmailDelivery(action, context.job, context.leaseId, context.env, context.database);
  },
  send_webhook: async (action, context) => {
    await createWebhookDelivery(
      action.endpointId,
      context.job,
      context.leaseId,
      context.env,
      context.database,
    );
  },
  add_tag: async (action, context) => {
    await context.engine.addContactTag(context.job, context.leaseId, action.tagId, context.now);
  },
  remove_tag: async (action, context) => {
    await context.engine.removeContactTag(context.job, context.leaseId, action.tagId);
  },
  add_segment: async (action, context) => {
    if (
      await context.engine.addAutomationSegmentMembership(
        context.job,
        context.leaseId,
        action.segmentId,
        context.now,
      )
    ) {
      await recordContactEvent(context.database, {
        workspaceId: context.job.workspaceId,
        contactId: context.job.contactId,
        type: "segment_joined",
        resourceType: "segment",
        resourceId: action.segmentId,
        queue: context.env.JOBS_QUEUE,
      });
    }
  },
  remove_segment: async (action, context) => {
    await context.engine.removeSegmentMembership(context.job, context.leaseId, action.segmentId);
  },
  change_score: async (action, context) => {
    await context.actionRepository.adjustContactScoreForJob(
      context.job,
      context.leaseId,
      automationNumber(action.amount),
      context.now,
      { operation: action.operation, categoryId: action.categoryId },
    );
  },
  update_field: async (action, context) => {
    await updateContactField(
      context.job,
      context.leaseId,
      action.field,
      action.value,
      context.engine,
    );
  },
} satisfies AutomationActionExecutorRegistry<AutomationActionExecutionContext>;

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
    const result = await executeNode(node, definition, job, leaseId, env, database, engine);
    if (result.parked) return;
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
  leaseId: string,
  env: RuntimeEnv,
  database: OpenEngageDatabase,
  engine: AutomationEngineRepository,
): Promise<{
  parked?: boolean;
  branch?: AutomationEdge["branch"];
  waitUntil?: string;
  waitEventType?: string;
  waitResourceId?: string | null;
  waitStartedAt?: string;
}> {
  if (node.type === "source") return { branch: "next" };
  if (node.type === "delay") {
    if (job.payload["waiting"] === true) return { branch: "next" };
    return {
      branch: "next",
      waitUntil: computeDueAt(node, new Date(), definition.timezone).toISOString(),
    };
  }
  if (node.type === "condition") {
    return {
      branch: await engine.captureCondition(
        job,
        leaseId,
        "filter" in node.config ? node.config.filter : await evaluateCondition(node, job, engine),
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
    const found = await engine.hasContactEventSince(
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
  if (action.action === "call_automation") {
    const child = await new AutomationCallRepository(database).startChild(
      job,
      leaseId,
      action.mode,
      new Date().toISOString(),
    );
    if (child.parked) return { parked: true };
    if (action.mode === "await" && child.status !== "completed")
      throw new PermanentChannelError(`Child automation ${child.id} ${child.status}`);
    return { branch: "next" };
  }
  const now = new Date().toISOString();
  const actionRepository = new AutomationActionRepository(database);
  await dispatchAutomationAction(automationActionExecutors, action, {
    actionRepository,
    database,
    engine,
    env,
    job,
    leaseId,
    now,
  });
  if (await actionRepository.hasRunningLease(job, leaseId)) {
    await enqueueSegmentContactReconciliation(env.JOBS_QUEUE, job.workspaceId, [job.contactId]);
  }
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
  leaseId: string,
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
      job,
      leaseId,
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
    job,
    leaseId,
    JSON.stringify(fields),
    new Date().toISOString(),
  );
}
