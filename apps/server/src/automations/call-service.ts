import { AutomationCallRepository } from "@openengage/database/automations";
import type { OpenEngageDatabase } from "@openengage/database/client";

import { logError } from "../observability";
export async function recoverAutomationCalls(
  database: OpenEngageDatabase,
  now = new Date(),
  limit = 100,
): Promise<number> {
  const repository = new AutomationCallRepository(database);
  for (const failure of await repository.claimChildFailures(now.toISOString(), limit))
    logError(
      failure.mode === "async"
        ? "automation.callable_async_failed"
        : "automation.callable_await_failed",
      new Error("Child automation failed"),
      failure,
    );
  return repository.recover(now.toISOString(), limit);
}
