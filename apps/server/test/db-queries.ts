import { env } from "cloudflare:workers";

/** The `count` column of a `SELECT COUNT(*) AS count ...` query, 0 when no row matches. */
export async function countRows(sql: string, ...binds: string[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
