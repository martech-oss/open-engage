import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";

import { member, user } from "../auth/schema";
import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { contactLifecycleHistory } from "./lifecycle-schema";
import { contacts } from "./schema";

type SalesStage = "mql" | "sql" | "customer";
const rank = { mql: 1, sql: 2, customer: 3 } as const;

export class LifecycleRepository extends WorkspaceRepository {
  public statements(contactId: string, stage: SalesStage, at: string, source: string, guard?: SQL) {
    const orm = this.database.orm;
    const scope = and(
      this.inWorkspace(contacts),
      eq(contacts.id, contactId),
      ne(contacts.status, "archived"),
      guard,
    );
    return [
      orm
        .insert(contactLifecycleHistory)
        .select(
          sql`SELECT ${this.context.workspaceId}, ${contactId}, ${stage}, ${at}, ${source} FROM ${contacts} WHERE ${scope}`,
        )
        .onConflictDoNothing(),
      orm
        .update(contacts)
        .set({ lifecycleStage: stage, updatedAt: sql`MAX(${contacts.updatedAt}, ${at})` })
        .where(
          and(
            scope,
            sql`CASE ${contacts.lifecycleStage} WHEN 'mql' THEN 1 WHEN 'sql' THEN 2 WHEN 'customer' THEN 3 ELSE 0 END < ${rank[stage]}`,
          ),
        ),
    ] as const;
  }

  public async advance(
    contactId: string,
    stage: SalesStage,
    at = nowIso(),
    source = "system",
  ): Promise<void> {
    await this.database.orm.batch([...this.statements(contactId, stage, at, source)]);
  }

  public async owner(contactId: string) {
    return (
      (await this.database.orm
        .select({ id: user.id, name: user.name })
        .from(contacts)
        .innerJoin(
          member,
          and(
            eq(member.organizationId, contacts.workspaceId),
            eq(member.userId, contacts.ownerUserId),
          ),
        )
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(this.inWorkspace(contacts), eq(contacts.id, contactId)))
        .get()) ?? null
    );
  }

  public async list(contactId: string) {
    return await this.database.orm
      .select()
      .from(contactLifecycleHistory)
      .where(
        and(
          this.inWorkspace(contactLifecycleHistory),
          eq(contactLifecycleHistory.contactId, contactId),
        ),
      )
      .orderBy(asc(contactLifecycleHistory.reachedAt));
  }
}
