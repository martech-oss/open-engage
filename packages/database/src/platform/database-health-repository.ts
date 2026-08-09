import { sql } from "drizzle-orm";

import { DatabaseRepository } from "../shared/repository-base";

/** Read-only database checks used by the application health endpoint. */
export class DatabaseHealthRepository extends DatabaseRepository {
  public async migrationCount(): Promise<number> {
    const result = await this.database.first<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM d1_migrations`,
    );
    return result?.count ?? 0;
  }
}
