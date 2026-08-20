import { type SQL } from "drizzle-orm";

import { DatabaseRepository } from "../shared/repository-base";
import type { ReportRow } from "./types";

export abstract class ReportsBatchRepository extends DatabaseRepository {
  /**
   * Runs several independent read-only queries concurrently. Generic over the
   * tuple of queries passed in so each destructured result is `ReportRow[]`
   * (not `ReportRow[] | undefined`) - the array length is fixed at every call
   * site, so callers can safely destructure by position. See the class-level
   * comment for why this is `Promise.all`, not a `database.orm.batch(...)`.
   */
  protected async runBatch<T extends readonly SQL[]>(
    ...queries: T
  ): Promise<{ [K in keyof T]: ReportRow[] }> {
    const results = await Promise.all(
      queries.map((query) => this.database.orm.all<ReportRow>(query)),
    );
    return results as unknown as { [K in keyof T]: ReportRow[] };
  }
}
