import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutomationNode } from "@openengage/core/automations";
import { createDatabase } from "@openengage/database/testing";

import { processAutomationJob } from "../src/automations/worker";
import { recordContactEvent } from "../src/contacts/event-service";
import { scheduled } from "../src/runtime/dispatch";
import {
  decisionNode,
  graph,
  queueStub,
  readJob,
  runtimeWithJobsQueue,
  seedAutomationJob,
} from "./automation-recovery-test-support";

afterEach(() => vi.useRealTimers());

describe("decision node recovery", () => {
  it("ignores a matching event that happened before the decision job was created", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:03:00.000Z"));
    const decision = decisionNode({ resourceId: "delivery-1", withinMinutes: 10 });
    const seeded = await seedAutomationJob({
      status: "leased",
      leaseId: "pre-node-event-lease",
      nodeId: decision.id,
      graph: graph([decision]),
      enteredAt: "2026-08-20T10:00:00.000Z",
      createdAt: "2026-08-20T10:02:00.000Z",
    });
    await processAutomationJob(
      seeded.jobId,
      "pre-node-event-lease",
      runtimeWithJobsQueue(queueStub()),
    );
    await recordContactEvent(createDatabase(env.DB), {
      workspaceId: seeded.workspaceId,
      contactId: seeded.contactId,
      type: "email_opened",
      resourceType: "delivery",
      resourceId: "delivery-1",
      occurredAt: "2026-08-20T10:01:00.000Z",
      queue: queueStub(),
    });

    expect(await readJob(seeded.jobId)).toMatchObject({
      status: "pending",
      dueAt: "2026-08-20T10:12:00.000Z",
    });
  });

  it("wakes a parked wait promptly when a matching event arrives, with null resource matching any", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T11:01:00.000Z"));
    const decision = decisionNode({ withinMinutes: 30 });
    const seeded = await seedAutomationJob({
      status: "leased",
      leaseId: "waiting-lease",
      nodeId: decision.id,
      graph: graph([decision]),
      enteredAt: "2026-08-20T11:00:00.000Z",
      createdAt: "2026-08-20T11:00:00.000Z",
    });
    await processAutomationJob(seeded.jobId, "waiting-lease", runtimeWithJobsQueue(queueStub()));

    vi.setSystemTime(new Date("2026-08-20T11:02:00.000Z"));
    await recordContactEvent(createDatabase(env.DB), {
      workspaceId: seeded.workspaceId,
      contactId: seeded.contactId,
      type: "email_opened",
      resourceType: "delivery",
      resourceId: "any-delivery",
      occurredAt: "2026-08-20T11:01:30.000Z",
      queue: queueStub(),
    });

    expect(await readJob(seeded.jobId)).toMatchObject({
      status: "pending",
      dueAt: "2026-08-20T11:02:00.000Z",
    });
  });

  it("takes the timeout branch at the withinMinutes deadline measured from job creation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:01:00.000Z"));
    const decision = decisionNode({ withinMinutes: 10 });
    const timeout: AutomationNode = {
      id: "timeout-action",
      type: "action",
      position: { x: 200, y: 0 },
      config: { action: "change_score", amount: -1 },
    };
    const seeded = await seedAutomationJob({
      status: "leased",
      leaseId: "deadline-lease",
      nodeId: decision.id,
      graph: graph(
        [decision, timeout],
        [
          {
            id: "decision-timeout",
            source: decision.id,
            target: timeout.id,
            branch: "timeout",
          },
        ],
      ),
      enteredAt: "2026-08-20T12:00:00.000Z",
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    await processAutomationJob(seeded.jobId, "deadline-lease", runtimeWithJobsQueue(queueStub()));

    vi.setSystemTime(new Date("2026-08-20T12:10:00.000Z"));
    await scheduled(
      createScheduledController({ cron: "* * * * *" }),
      runtimeWithJobsQueue(queueStub()),
      createExecutionContext(),
    );
    const claimed = await env.DB.prepare(
      "SELECT id, lease_id AS leaseId FROM automation_jobs WHERE enrollment_id = ? AND node_id = ? AND status = 'leased'",
    )
      .bind(seeded.enrollmentId, decision.id)
      .first<{ id: string; leaseId: string }>();
    if (!claimed) throw new Error("decision job was not claimed at its deadline");
    await processAutomationJob(claimed.id, claimed.leaseId, runtimeWithJobsQueue(queueStub()));

    const next = await env.DB.prepare(
      "SELECT node_id AS nodeId, status FROM automation_jobs WHERE enrollment_id = ? AND node_id = ?",
    )
      .bind(seeded.enrollmentId, timeout.id)
      .first<{ nodeId: string; status: string }>();
    expect(next).toEqual({ nodeId: timeout.id, status: "pending" });
  });

  it("stores indexed event and resource keys while a decision wait is parked", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info('automation_jobs')").all<{
      name: string;
    }>();
    const indexes = await env.DB.prepare("PRAGMA index_list('automation_jobs')").all<{
      name: string;
    }>();

    expect(columns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining(["wait_event_type", "wait_resource_id"]),
    );
    expect(indexes.results.map((index) => index.name)).toContain("automation_jobs_wait_event_idx");
  });
});
