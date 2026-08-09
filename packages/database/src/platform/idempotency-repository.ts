import { and, eq, gt } from "drizzle-orm";

import { nowIso } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { idempotencyKeys } from "./schema";

export class IdempotencyRepository extends DatabaseRepository {
  public async reserve(
    workspaceId: string,
    scope: string,
    key: string,
    expiresAt: string,
  ): Promise<boolean> {
    const result = await this.database.orm
      .insert(idempotencyKeys)
      .values({ workspaceId, scope, idempotencyKey: key, createdAt: nowIso(), expiresAt })
      .onConflictDoNothing();
    return result.meta.changes === 1;
  }

  public async store(
    workspaceId: string,
    scope: string,
    key: string,
    responseBody: string,
    expiresAt: string,
  ): Promise<void> {
    await this.database.orm.insert(idempotencyKeys).values({
      workspaceId,
      scope,
      idempotencyKey: key,
      responseBody,
      createdAt: nowIso(),
      expiresAt,
    });
  }

  /** Atomically returns and removes one unexpired value. */
  public async consume(
    workspaceId: string,
    scope: string,
    key: string,
    now: string,
  ): Promise<string | null> {
    const [row] = await this.database.orm
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.workspaceId, workspaceId),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.idempotencyKey, key),
          gt(idempotencyKeys.expiresAt, now),
        ),
      )
      .returning({ responseBody: idempotencyKeys.responseBody });
    return row?.responseBody ?? null;
  }
}
