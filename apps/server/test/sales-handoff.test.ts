import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { RuntimeEnv } from "../src/env";
import { createAutomationExecutionDependencies } from "../src/runtime/automation-execution";
import { seedWorkspaceClient, seedMember } from "./factory";

describe("sales handoff and unified tasks", () => {
  it("assigns once and atomically creates a contact task and notification on retries", async () => {
    const { client, userId, workspaceId } = await seedWorkspaceClient(env.DB);
    await seedMember(env.DB, { workspaceId, userId });
    const contact = await client.contacts.create({ email: "handoff@example.com" });
    const input = {
      contactId: contact.id,
      executionKey: "manual-1",
      ownerUserId: userId,
      title: "Call lead",
    };
    const [first, retry] = await Promise.all([
      client.deals.handoff(input),
      client.deals.handoff(input),
    ]);
    expect(retry.id).toBe(first.id);
    expect(
      (await client.deals.listTasks({ status: "all" })).filter(
        (task) => task.contactId === contact.id,
      ),
    ).toHaveLength(1);
    expect(await client.deals.notifications({})).toHaveLength(1);
    const row = await env.DB.prepare(
      "SELECT owner_user_id, lifecycle_stage FROM contacts WHERE workspace_id = ? AND id = ?",
    )
      .bind(workspaceId, contact.id)
      .first();
    expect(row).toEqual({ owner_user_id: userId, lifecycle_stage: "mql" });
  });
  it("fails assignment after its last member becomes ineligible without partial effects", async () => {
    const fixture = await seedWorkspaceClient(env.DB);
    const { client, userId, workspaceId } = fixture;
    await seedMember(env.DB, fixture);
    const contact = await client.contacts.create({ email: "empty@example.com" });
    const group = await client.deals.saveAssignmentGroup({
      name: "Sales",
      userIds: [userId],
      mode: "round_robin",
    });
    await expect(
      client.deals.saveAssignmentGroup({
        id: group.id,
        name: "Empty",
        mode: "round_robin",
        userIds: [],
      }),
    ).rejects.toThrow();
    expect(
      (await client.deals.assignmentGroups()).find((item) => item.id === group.id)?.userIds,
    ).toEqual([userId]);
    await env.DB.prepare("DELETE FROM member WHERE organization_id=? AND user_id=?")
      .bind(workspaceId, userId)
      .run();
    await expect(
      client.deals.handoff({
        contactId: contact.id,
        executionKey: "empty",
        groupId: group.id,
        title: "Call",
      }),
    ).rejects.toMatchObject({ code: "INVALID_DEAL_REFERENCE" });
    expect(await client.deals.listTasks({ status: "all" })).toHaveLength(0);
  });
  it("rejects tasks with mismatched links", async () => {
    const { client } = await seedWorkspaceClient(env.DB);
    const one = await client.contacts.create({ email: "one@example.com" });
    const two = await client.contacts.create({ email: "two@example.com" });
    const pipeline = (await client.deals.options()).pipelines[0]!;
    const deal = await client.deals.create({
      name: "Deal",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0]!.id,
      contactId: one.id,
    });
    await expect(
      client.deals.createContactTask({ contactId: two.id, dealId: deal.id, title: "Mismatch" }),
    ).rejects.toMatchObject({ code: "INVALID_DEAL_REFERENCE" });
  });
});

it("serializes round robin across concurrent handoffs and preserves a valid owner", async () => {
  const first = await seedWorkspaceClient(env.DB),
    second = await seedWorkspaceClient(env.DB);
  await seedMember(env.DB, first);
  await seedMember(env.DB, {
    workspaceId: first.workspaceId,
    userId: second.userId,
    role: "marketer",
  });
  const group = await first.client.deals.saveAssignmentGroup({
    name: "Sales",
    mode: "round_robin",
    userIds: [first.userId, second.userId],
  });
  const contacts = await Promise.all(
    ["rr1", "rr2"].map((name) => first.client.contacts.create({ email: `${name}@example.com` })),
  );
  const results = await Promise.all(
    contacts.map((contact, index) =>
      first.client.deals.handoff({
        contactId: contact.id,
        executionKey: `rr-${index}`,
        groupId: group.id,
        title: "Call",
      }),
    ),
  );
  expect(new Set(results.map((result) => result.ownerUserId)).size).toBe(2);
  const preserved = await first.client.deals.handoff({
    contactId: contacts[0]!.id,
    executionKey: "keep",
    ownerUserId: second.userId,
    title: "Follow up",
  });
  expect(preserved.ownerUserId).toBe(results[0]!.ownerUserId);
  await first.client.deals.setTaskStatus({ taskId: preserved.taskId, status: "completed" });
  expect(
    (await first.client.deals.contactTasks({ contactId: contacts[0]!.id })).find(
      (task) => task.id === preserved.taskId,
    )?.status,
  ).toBe("completed");
});

it("enforces task links in the database and cascades deal contact rebinds", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  const one = await client.contacts.create({ email: "rebind-one@example.com" }),
    two = await client.contacts.create({ email: "rebind-two@example.com" });
  const pipeline = (await client.deals.options()).pipelines[0]!;
  const deal = await client.deals.create({
    name: "Rebind",
    contactId: one.id,
    pipelineId: pipeline.id,
    stageId: pipeline.stages[0]!.id,
  });
  const task = await client.deals.createContactTask({
    contactId: one.id,
    dealId: deal.id,
    title: "Follow up",
  });
  await expect(
    env.DB.prepare("UPDATE deal_tasks SET contact_id=? WHERE id=?").bind(two.id, task.id).run(),
  ).rejects.toThrow();
  await client.deals.update({ id: deal.id, contactId: two.id });
  expect(
    (await client.deals.contactTasks({ contactId: two.id })).map((task) => task.contactId),
  ).toContain(two.id);
});

it("edits and deletes the same contact task resource with workspace isolation", async () => {
  const first = await seedWorkspaceClient(env.DB),
    foreign = await seedWorkspaceClient(env.DB);
  const contact = await first.client.contacts.create({ email: "task-edit@example.com" });
  const task = await first.client.deals.createContactTask({
    contactId: contact.id,
    title: "Original",
  });
  await expect(
    foreign.client.deals.updateTaskResource({ taskId: task.id, title: "Foreign" }),
  ).rejects.toMatchObject({ code: "DEAL_TASK_NOT_FOUND" });
  await first.client.deals.updateTaskResource({
    taskId: task.id,
    title: "Follow up",
    notes: "Discuss plan",
    dueAt: "2027-01-01T00:00:00.000Z",
  });
  expect((await first.client.deals.contactTasks({ contactId: contact.id }))[0]).toMatchObject({
    title: "Follow up",
    notes: "Discuss plan",
  });
  await first.client.deals.deleteTaskResource({ taskId: task.id });
  expect(await first.client.deals.listTasks({ status: "all" })).toHaveLength(0);
});

it("does not consume a round-robin turn when preserving an existing owner", async () => {
  const fixture = await seedWorkspaceClient(env.DB);
  await seedMember(env.DB, fixture);
  const contact = await fixture.client.contacts.create({ email: "preserve-turn@example.com" });
  await fixture.client.deals.handoff({
    contactId: contact.id,
    executionKey: "assign-owner",
    ownerUserId: fixture.userId,
  });
  const group = await fixture.client.deals.saveAssignmentGroup({
    name: "Pool",
    mode: "round_robin",
    userIds: [fixture.userId],
  });
  await fixture.client.deals.handoff({
    contactId: contact.id,
    executionKey: "keep-owner",
    groupId: group.id,
  });
  expect(
    await env.DB.prepare("SELECT cursor FROM assignment_groups WHERE id=?").bind(group.id).first(),
  ).toEqual({ cursor: 0 });
});

it("rechecks assignment eligibility after group members lose marketing access", async () => {
  const fixture = await seedWorkspaceClient(env.DB);
  await seedMember(env.DB, fixture);
  const contact = await fixture.client.contacts.create({ email: "ineligible@example.com" });
  const group = await fixture.client.deals.saveAssignmentGroup({
    name: "Sales",
    mode: "fixed",
    userIds: [fixture.userId],
  });
  await env.DB.prepare("UPDATE member SET role='viewer' WHERE organization_id=? AND user_id=?")
    .bind(fixture.workspaceId, fixture.userId)
    .run();
  await expect(
    fixture.client.deals.handoff({
      contactId: contact.id,
      groupId: group.id,
      executionKey: "ineligible",
    }),
  ).rejects.toMatchObject({ code: "INVALID_DEAL_REFERENCE" });
  expect(await fixture.client.deals.listTasks({ status: "all" })).toHaveLength(0);
  expect(
    await env.DB.prepare("SELECT lifecycle_stage,owner_user_id FROM contacts WHERE id=?")
      .bind(contact.id)
      .first(),
  ).toEqual({ lifecycle_stage: "lead", owner_user_id: null });
});

it("executes the automation handoff action once per enrollment and permits explicit reentry", async () => {
  const { processAutomationJob } = await import("../src/automations/worker");
  const fixture = await seedWorkspaceClient(env.DB);
  await seedMember(env.DB, fixture);
  const contact = await fixture.client.contacts.create({ email: "automation-sales@example.com" });
  const automation = await fixture.client.automations.create({
    name: "Sales automation",
    description: "",
    timezone: "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "api_event", eventName: "qualified", reentry: "every_time" },
      },
      {
        id: "handoff",
        type: "action",
        position: { x: 100, y: 0 },
        config: {
          action: "handoff_to_sales",
          ownerUserId: fixture.userId,
          preserveOwner: true,
          title: "Call lead",
        },
      },
    ],
    edges: [{ id: "next", source: "source", target: "handoff", branch: "next" }],
  });
  await fixture.client.automations.publish({ id: automation.id });
  for (let i = 0; i < 2; i++)
    await fixture.client.contacts.recordEvent({
      id: contact.id,
      eventName: "qualified",
      properties: { round: i },
    });
  const runtime = {
    ...env,
    JOBS_QUEUE: { send: async () => {}, sendBatch: async () => {} },
  } as unknown as RuntimeEnv;
  for (let step = 0; step < 4; step++) {
    const job = await env.DB.prepare(
      "SELECT id FROM automation_jobs WHERE workspace_id=? AND status='pending' ORDER BY created_at,id LIMIT 1",
    )
      .bind(fixture.workspaceId)
      .first<{ id: string }>();
    expect(job).not.toBeNull();
    await env.DB.prepare(
      "UPDATE automation_jobs SET status='leased',lease_id='sales-test',lease_until='2099-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(job!.id)
      .run();
    await processAutomationJob(
      job!.id,
      "sales-test",
      createAutomationExecutionDependencies(runtime),
    );
    await processAutomationJob(
      job!.id,
      "sales-test",
      createAutomationExecutionDependencies(runtime),
    );
  }
  expect(await fixture.client.deals.listTasks({ status: "all" })).toHaveLength(2);
  expect(await fixture.client.deals.notifications({})).toHaveLength(2);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM contact_lifecycle_history WHERE workspace_id=? AND contact_id=? AND stage='mql'",
    )
      .bind(fixture.workspaceId, contact.id)
      .first(),
  ).toEqual({ count: 1 });
});

it("preserves completion time across duplicate writes and assigns a new time after reopening", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  const contact = await client.contacts.create({ email: "completion@example.com" });
  const task = await client.deals.createContactTask({
    contactId: contact.id,
    title: "Call",
    type: "call",
  });
  await client.deals.setTaskStatus({ taskId: task.id, status: "completed" });
  const firstTime = "2026-01-01T00:00:00.000Z";
  await env.DB.prepare("UPDATE deal_tasks SET completed_at=? WHERE id=?")
    .bind(firstTime, task.id)
    .run();
  await client.deals.setTaskStatus({ taskId: task.id, status: "completed" });
  await client.deals.updateTaskResource({ taskId: task.id, status: "completed", title: "Called" });
  expect((await client.deals.contactTasks({ contactId: contact.id }))[0]?.completedAt).toBe(
    firstTime,
  );
  await client.deals.setTaskStatus({ taskId: task.id, status: "open" });
  expect((await client.deals.contactTasks({ contactId: contact.id }))[0]?.completedAt).toBeNull();
  await client.deals.setTaskStatus({ taskId: task.id, status: "completed" });
  expect((await client.deals.contactTasks({ contactId: contact.id }))[0]?.completedAt).not.toBe(
    firstTime,
  );
});
