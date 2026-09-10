import type { OpenEngageDatabase } from "@openengage/database/client";
import { ScoringDecayRepository } from "@openengage/database/scoring";

import { processPendingPublicFormEvent } from "../runtime/contact-event-service";

/** Bounded per invocation; due rows are the durable worklist for queue continuation and cron recovery. */
export async function runScoringDecay(
  database: OpenEngageDatabase,
  queue?: Queue,
  now = new Date(),
  limit = 20,
): Promise<void> {
  const repository = new ScoringDecayRepository(database);
  for (const contribution of await repository.listDue(now.toISOString(), limit)) {
    const eventId = await repository.decay(contribution, now);
    if (eventId) await processPendingPublicFormEvent(database, eventId, queue);
  }
  if (queue && (await repository.listDue(now.toISOString(), 1)).length > 0) {
    // Preserve the cutoff so continuation does not chase contributions due on later days.
    await queue.send({ kind: "scoring_decay", now: now.toISOString() });
  }
}
