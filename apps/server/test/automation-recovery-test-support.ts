import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";

import type { AutomationDefinition, AutomationNode } from "@openengage/core/automations";
import {
  automationEnrollments,
  automationJobs,
  automations,
  automationVersions,
  contacts,
  createDatabase,
  uuidv7,
} from "@openengage/database/testing";

import type { RuntimeEnv } from "../src/env";
import { seedWorkspace } from "./factory";

export async function seedAutomationJob(input: {
  status: "pending" | "leased" | "running";
  attempts?: number;
  leaseId?: string | null;
  leaseUntil?: string | null;
  nodeId?: string;
  graph?: AutomationDefinition;
  enteredAt?: string;
  createdAt?: string;
  dueAt?: string;
}) {
  const { workspaceId } = await seedWorkspace(env.DB);
  const contactId = uuidv7();
  const automationId = uuidv7();
  const automationVersionId = uuidv7();
  const enrollmentId = uuidv7();
  const jobId = uuidv7();
  const createdAt = input.createdAt ?? "2026-08-20T00:00:00.000Z";
  const enteredAt = input.enteredAt ?? createdAt;
  const nodeId = input.nodeId ?? "source";
  const definition =
    input.graph ??
    graph([
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "contact_created", reentry: "once" },
      },
    ]);
  const orm = createDatabase(env.DB).orm;
  await orm.batch([
    orm.insert(contacts).values({
      id: contactId,
      workspaceId,
      email: `${contactId}@example.com`,
      status: "active",
      customFields: "{}",
      createdAt,
      updatedAt: createdAt,
    }),
    orm.insert(automations).values({
      id: automationId,
      workspaceId,
      name: "Recovery fixture",
      status: "active",
      publishedVersionId: automationVersionId,
      createdAt,
      updatedAt: createdAt,
    }),
    orm.insert(automationVersions).values({
      id: automationVersionId,
      workspaceId,
      automationId,
      version: 1,
      status: "published",
      timezone: "UTC",
      graph: JSON.stringify(definition),
      publishedAt: createdAt,
      createdAt,
    }),
  ]);
  await orm.batch([
    orm.insert(automationEnrollments).values({
      id: enrollmentId,
      workspaceId,
      automationId,
      automationVersionId,
      contactId,
      sourceEventId: uuidv7(),
      status: "active",
      currentNodeId: nodeId,
      enteredAt,
      updatedAt: enteredAt,
    }),
    orm.insert(automationJobs).values({
      id: jobId,
      workspaceId,
      enrollmentId,
      automationVersionId,
      nodeId,
      contactId,
      idempotencyKey: `${enrollmentId}:${nodeId}:${contactId}`,
      status: input.status,
      dueAt: input.dueAt ?? "2000-01-01T00:00:00.000Z",
      leaseId: input.leaseId ?? null,
      leaseUntil: input.leaseUntil ?? null,
      attempts: input.attempts ?? 0,
      createdAt,
      updatedAt: createdAt,
    }),
  ]);
  return { workspaceId, contactId, enrollmentId, jobId };
}

export function graph(
  nodes: AutomationDefinition["nodes"],
  edges: AutomationDefinition["edges"] = [],
): AutomationDefinition {
  return {
    name: "Recovery fixture",
    description: "",
    timezone: "UTC",
    nodes,
    edges,
  };
}

export function decisionNode(input: {
  resourceId?: string;
  withinMinutes: number;
}): Extract<AutomationNode, { type: "decision" }> {
  return {
    id: "decision",
    type: "decision",
    position: { x: 0, y: 0 },
    config: {
      event: "opened",
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      withinMinutes: input.withinMinutes,
    },
  };
}

export function queueStub(
  sendBatch: (messages: Iterable<MessageSendRequest<unknown>>) => Promise<void> = async () => {},
): Queue {
  return {
    send: async () => {},
    sendBatch,
  } as unknown as Queue;
}

export function runtimeWithJobsQueue(queue: Queue): RuntimeEnv {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "JOBS_QUEUE") return queue;
      return Reflect.get(target, property, receiver);
    },
  }) as RuntimeEnv;
}

export async function readJob(jobId: string): Promise<{
  status: string;
  attempts: number;
  dueAt: string;
  leaseId: string | null;
  leaseUntil: string | null;
} | null> {
  return (
    (await createDatabase(env.DB)
      .orm.select({
        status: automationJobs.status,
        attempts: automationJobs.attempts,
        dueAt: automationJobs.dueAt,
        leaseId: automationJobs.leaseId,
        leaseUntil: automationJobs.leaseUntil,
      })
      .from(automationJobs)
      .where(eq(automationJobs.id, jobId))
      .get()) ?? null
  );
}

export async function expectJobAndEnrollment(
  jobId: string,
  enrollmentId: string,
  jobStatus: string,
  enrollmentStatus: string,
): Promise<void> {
  const row = await createDatabase(env.DB)
    .orm.select({
      jobStatus: automationJobs.status,
      enrollmentStatus: automationEnrollments.status,
    })
    .from(automationJobs)
    .innerJoin(
      automationEnrollments,
      and(
        eq(automationEnrollments.id, automationJobs.enrollmentId),
        eq(automationEnrollments.id, enrollmentId),
      ),
    )
    .where(eq(automationJobs.id, jobId))
    .get();
  expect(row).toEqual({ jobStatus, enrollmentStatus });
}
