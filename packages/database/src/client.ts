import type { SQL } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import { schema } from "./schema";

export type Database = DrizzleD1Database<typeof schema>;
export type DatabaseSource = D1Database | OpenEngageDatabase;

/**
 * Application-wide database entry point.
 *
 * All access goes through `orm`: the Drizzle query builder, or `sql` tagged
 * templates with `${table.column}` interpolation for the handful of queries
 * the builder can't express (see the repository classes under
 * packages/database/src/*​/*.ts). `first` accepts a proper drizzle `SQL`
 * object, never a string - apps/server/src makes no raw `.prepare(`
 * calls of its own (enforced by scripts/architecture/rules.mjs).
 */
export class OpenEngageDatabase {
  public readonly orm: Database;

  public constructor(binding: D1Database) {
    this.orm = drizzle(binding, { schema, casing: "snake_case" });
  }

  public async first<T>(query: SQL): Promise<T | null> {
    return (await this.orm.get<T>(query)) ?? null;
  }
}

const databases = new WeakMap<D1Database, OpenEngageDatabase>();

export function createDatabase(binding: DatabaseSource): OpenEngageDatabase {
  if (binding instanceof OpenEngageDatabase) return binding;
  const existing = databases.get(binding);
  if (existing) return existing;
  const database = new OpenEngageDatabase(binding);
  databases.set(binding, database);
  return database;
}
