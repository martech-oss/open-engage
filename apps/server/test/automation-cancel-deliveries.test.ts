import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

import { AutomationExecutionRepository } from "@openengage/database/automations";
import { createDatabase, deliveries, uuidv7 } from "@openengage/database/testing";

import { enrollContactManually } from "../src/automations/enrollment";
import { processDelivery } from "../src/messaging/delivery-worker";
import { seedWorkspaceClient } from "./factory";

async function enrolledContact() {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const automation = await client.automations.create({
    name: "Nurture",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 0, y: 0 },
        config: { source: "api_event", eventName: "start" },
      },
    ],
    edges: [],
  });
  await client.automations.publish({ id: automation.id });
  const contact = await client.contacts.create({ email: "nurture@example.com", customFields: {} });
  const db = createDatabase(env.DB);
  const enrolled = await enrollContactManually(db, {
    workspaceId,
    automationId: automation.id,
    contactId: contact.id,
  });
  if (enrolled.kind !== "enrolled") throw new Error("Expected an enrollment");
  return { db, workspaceId, contactId: contact.id, enrollmentId: enrolled.result.enrollmentId };
}

async function seedQueuedWebhook(
  db: ReturnType<typeof createDatabase>,
  input: { workspaceId: string; contactId: string; enrollmentId: string },
): Promise<string> {
  const id = uuidv7();
  const now = new Date().toISOString();
  await db.orm.insert(deliveries).values({
    id,
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    enrollmentId: input.enrollmentId,
    channel: "webhook",
    purpose: "transactional",
    provider: "webhook",
    recipient: "https://hooks.example.com/a",
    idempotencyKey: `key-${id}`,
    payload: JSON.stringify({
      kind: "webhook",
      idempotencyKey: `key-${id}`,
      workspaceId: input.workspaceId,
      deliveryId: id,
      endpointId: "endpoint",
      payload: {},
    }),
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function readStatus(db: ReturnType<typeof createDatabase>, id: string) {
  return db.orm
    .select({ status: deliveries.status, lastError: deliveries.lastError })
    .from(deliveries)
    .where(eq(deliveries.id, id))
    .get();
}

it("cancels the queued messages of a cancelled enrollment", async () => {
  const fixture = await enrolledContact();
  const queued = await seedQueuedWebhook(fixture.db, fixture);

  await new AutomationExecutionRepository(fixture.db, {
    workspaceId: fixture.workspaceId,
  }).cancelEnrollment(fixture.enrollmentId);

  await expect(readStatus(fixture.db, queued)).resolves.toEqual({
    status: "cancelled",
    lastError: "automation_cancelled",
  });
});

it("does not send a message re-queued after its enrollment was cancelled", async () => {
  const fixture = await enrolledContact();
  await new AutomationExecutionRepository(fixture.db, {
    workspaceId: fixture.workspaceId,
  }).cancelEnrollment(fixture.enrollmentId);
  // A send that was mid-flight during cancellation and failed transiently returns to the queue.
  const requeued = await seedQueuedWebhook(fixture.db, fixture);
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  await processDelivery(requeued, env);

  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
  await expect(readStatus(fixture.db, requeued)).resolves.toEqual({
    status: "cancelled",
    lastError: "automation_cancelled",
  });
});
