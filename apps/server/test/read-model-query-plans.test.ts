import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { AutomationRepository, DealRepository, createDatabase } from "@openengage/database/testing";

import { seedWorkspaceClient } from "./factory";

describe("aggregate read-model query plans", () => {
  it("materializes automation trigger and enrollment summaries without correlated scans", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const automation = await client.automations.create({
      name: "Aggregate plan",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "contact_created", reentry: "once" },
        },
      ],
      edges: [],
    });
    await client.automations.publish({ id: automation.id });
    const captured = capturePreparedQueries(env.DB);

    const rows = await new AutomationRepository(createDatabase(captured.database), {
      workspaceId,
    }).listAutomationsWithCounts();

    expect(rows).toEqual([
      expect.objectContaining({
        id: automation.id,
        triggerSource: "contact_created",
        enrollmentCount: 0,
        activeCount: 0,
        completedCount: 0,
      }),
    ]);
    const plan = await explainCapturedQuery(
      captured.queries.find((query) => query.sql.includes('from "automations"')),
    );
    expect(plan.some((detail) => detail.includes("CORRELATED SCALAR SUBQUERY"))).toBe(false);
    expect(plan.filter((detail) => detail.includes("MATERIALIZE"))).toHaveLength(2);
  });

  it("materializes open-task aggregates without duplicating deals or losing null due dates", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const pipeline = (await client.deals.options()).pipelines[0]!;
    const deal = await client.deals.create({
      name: "Task summary plan",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0]!.id,
      value: 0,
      currency: "JPY",
    });
    await client.deals.createTask({ dealId: deal.id, title: "No due date" });
    const dated = await client.deals.createTask({
      dealId: deal.id,
      title: "Dated",
      dueAt: "2026-09-01T00:00:00.000Z",
    });
    const completed = await client.deals.createTask({
      dealId: deal.id,
      title: "Completed",
      dueAt: "2026-08-01T00:00:00.000Z",
    });
    await client.deals.updateTask({
      dealId: deal.id,
      taskId: completed.id,
      status: "completed",
    });
    const captured = capturePreparedQueries(env.DB);

    const result = await new DealRepository(createDatabase(captured.database), {
      workspaceId,
    }).listDeals({ pipelineId: pipeline.id, status: "all" });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: deal.id,
        openTaskCount: 2,
        nextTaskAt: dated.dueAt,
      }),
    ]);
    const plan = await explainCapturedQuery(
      captured.queries.find(
        (query) => query.sql.includes('from "deals"') && query.sql.includes('"deal_tasks"'),
      ),
    );
    expect(plan.some((detail) => detail.includes("CORRELATED SCALAR SUBQUERY"))).toBe(false);
    expect(plan.filter((detail) => detail.includes("MATERIALIZE"))).toHaveLength(1);
  });
});

interface CapturedQuery {
  sql: string;
  params: Array<string | number | null>;
}

function capturePreparedQueries(source: D1Database): {
  database: D1Database;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];
  return {
    database: new Proxy(source, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const captured: CapturedQuery = { sql, params: [] };
            queries.push(captured);
            const prepared = target.prepare(sql);
            return new Proxy(prepared, {
              get(statement, statementProperty) {
                if (statementProperty === "bind") {
                  return (...params: Array<string | number | null>) => {
                    captured.params = params;
                    return statement.bind(...params);
                  };
                }
                const value = Reflect.get(statement, statementProperty, statement) as unknown;
                return typeof value === "function" ? value.bind(statement) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    queries,
  };
}

async function explainCapturedQuery(query: CapturedQuery | undefined): Promise<string[]> {
  expect(query).toBeDefined();
  const result = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query!.sql}`)
    .bind(...query!.params)
    .all<{ detail: string }>();
  return result.results.map((row) => row.detail);
}
