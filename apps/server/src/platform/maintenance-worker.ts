import {
  createDatabase,
  DeadLetterRepository,
  GeneratedEmailImageRepository,
  MaintenanceRepository,
  uuidv7,
} from "@openengage/database";

import { type RuntimeEnv } from "../env";
import { primitiveString } from "./values";

export async function persistDeadLetter(
  queueName: string,
  body: unknown,
  attempts: number,
  env: RuntimeEnv,
  error = "Queue retries exhausted",
): Promise<void> {
  const parsed = body as { jobId?: string; deliveryId?: string };
  const repository = new DeadLetterRepository(createDatabase(env.DB));
  let workspaceId: string | null = null;
  if (parsed.jobId) {
    workspaceId = await repository.findJobWorkspace(parsed.jobId);
  } else if (parsed.deliveryId) {
    workspaceId = await repository.findDeliveryWorkspace(parsed.deliveryId);
  }
  await repository.insert({
    id: uuidv7(),
    workspaceId,
    sourceQueue: queueName,
    messageBody: JSON.stringify(body),
    error,
    attempts,
    createdAt: new Date().toISOString(),
  });
}

export async function runDailyMaintenance(env: RuntimeEnv): Promise<void> {
  const retentionDays = Math.max(1, Number(env.RAW_EVENT_RETENTION_DAYS) || 90);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const repository = new MaintenanceRepository(createDatabase(env.DB));
  const events = await repository.findEventsToArchive(cutoff);
  if (events.length > 0) {
    const firstWorkspace = primitiveString(events[0]?.["workspaceId"], "unknown");
    const key = `${firstWorkspace}/archives/contact-events/${new Date().toISOString()}.${uuidv7()}.ndjson`;
    await env.ASSETS_BUCKET.put(key, events.map((event) => JSON.stringify(event)).join("\n"), {
      httpMetadata: { contentType: "application/x-ndjson" },
    });
    for (let offset = 0; offset < events.length; offset += 50) {
      const chunk = events.slice(offset, offset + 50);
      await repository.archiveEvents(
        chunk.map((event) => primitiveString(event["id"])),
        new Date().toISOString(),
      );
    }
  }
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await repository.rollupDailyMetrics(yesterday);
  await repository.purgeExpiredIdempotencyKeys(new Date().toISOString());
  await repository.purgeProcessedContactEventWork(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  );
  await repository.reconcileContactScores(new Date().toISOString());
  await purgeExpiredGeneratedEmailImages(env);
}

async function purgeExpiredGeneratedEmailImages(env: RuntimeEnv): Promise<void> {
  const repository = new GeneratedEmailImageRepository(createDatabase(env.DB));
  const expired = await repository.findExpired(new Date().toISOString());
  if (expired.length === 0) return;
  await Promise.all(expired.map((image) => env.ASSETS_BUCKET.delete(image.r2Key)));
  await repository.deleteExpiredRows(expired.map((image) => image.assetId));
}
