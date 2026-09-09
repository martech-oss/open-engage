import type { OpenEngageDatabase } from "@openengage/database/client";
import { ScoringDecayRepository } from "@openengage/database/scoring";

import { processPendingPublicFormEvent } from "../runtime/contact-event-service";

/** Bounded per cron tick; any interrupted projections remain in the existing event outbox. */
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
}
