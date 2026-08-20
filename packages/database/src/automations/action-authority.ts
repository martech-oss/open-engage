import { and, eq, exists } from "drizzle-orm";

import type { OpenEngageDatabase } from "../client";
import { automationJobs } from "./schema";

export interface AutomationActionAuthority {
  jobId: string;
  workspaceId: string;
  leaseId: string;
}

/** SQL predicate proving that this action still owns the current running job. */
export function runningActionLeaseExists(
  database: OpenEngageDatabase,
  authority: AutomationActionAuthority,
) {
  return exists(
    database.orm
      .select({ id: automationJobs.id })
      .from(automationJobs)
      .where(
        and(
          eq(automationJobs.id, authority.jobId),
          eq(automationJobs.workspaceId, authority.workspaceId),
          eq(automationJobs.status, "running"),
          eq(automationJobs.leaseId, authority.leaseId),
        ),
      ),
  );
}
