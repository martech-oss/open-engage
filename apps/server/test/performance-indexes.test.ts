import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("performance indexes", () => {
  it("migrates workspace-time indexes used by event and delivery scans", async () => {
    await expect(indexNames("contact_events")).resolves.toContain(
      "contact_events_workspace_occurred_idx",
    );
    await expect(indexNames("deliveries")).resolves.toContain("deliveries_workspace_created_idx");
  });

  it("uses the contact event index for the dashboard recent-events query", async () => {
    const plan = await queryPlan(
      `SELECT type, occurred_at, contact_id, properties
       FROM contact_events
       WHERE workspace_id = ?
       ORDER BY occurred_at DESC
       LIMIT 20`,
      ["workspace-query-plan"],
    );

    expect(plan).toMatch(/USING INDEX contact_events_workspace_occurred_idx/i);
  });

  it("uses the delivery index for the dashboard totals-range query", async () => {
    const plan = await queryPlan(
      `SELECT COUNT(*) AS sent,
              SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM deliveries
       WHERE workspace_id = ?
         AND created_at >= ?
         AND created_at < ?`,
      ["workspace-query-plan", "2026-07-27T00:00:00.000Z", "2026-08-26T00:00:00.000Z"],
    );

    expect(plan).toMatch(/USING INDEX deliveries_workspace_created_idx/i);
  });
});

async function indexNames(table: string): Promise<string[]> {
  const rows = await env.DB.prepare(`SELECT name FROM pragma_index_list('${table}')`).all<{
    name: string;
  }>();
  return rows.results.map((row) => row.name);
}

async function queryPlan(query: string, bindings: string[]): Promise<string> {
  const rows = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query}`)
    .bind(...bindings)
    .all<{ detail: string }>();
  return rows.results.map((row) => row.detail).join("\n");
}
