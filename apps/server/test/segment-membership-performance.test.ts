import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { compileSegmentFilter } from "@openengage/core/segments";
import { createDatabase } from "@openengage/database/testing";

import { reconcileContactSegmentMemberships } from "../src/segments/membership-service";
import { seedWorkspaceClient } from "./factory";

describe("incremental segment membership performance", () => {
  it("uses at most one definition query plus two round trips per group of 50", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "batched-segments@example.com",
      customFields: {},
    });
    const segmentCount = 51;
    await insertDynamicSegments(workspaceId, segmentCount, {
      kind: "condition",
      field: "score",
      operator: "gte",
      value: 50,
    });
    await client.contacts.adjustScore({ contactId: contact.id, delta: 60, reason: "qualified" });
    const maxRoundTrips = 1 + 2 * Math.ceil(segmentCount / 50);
    const counted = countDatabaseRoundTrips(env.DB);

    const firstStart = counted.count();
    await reconcileContactSegmentMemberships(
      createDatabase(counted.database),
      workspaceId,
      contact.id,
    );
    const firstRoundTrips = counted.count() - firstStart;
    expect(firstRoundTrips).toBe(5);
    expect(firstRoundTrips).toBeLessThanOrEqual(maxRoundTrips);
    expect(await membershipSummary(workspaceId, contact.id)).toEqual({
      memberships: segmentCount,
      memberCount: segmentCount,
    });

    const replayStart = counted.count();
    await reconcileContactSegmentMemberships(
      createDatabase(counted.database),
      workspaceId,
      contact.id,
    );
    const replayRoundTrips = counted.count() - replayStart;
    expect(replayRoundTrips).toBe(5);
    expect(replayRoundTrips).toBeLessThanOrEqual(maxRoundTrips);
    expect(await membershipSummary(workspaceId, contact.id)).toEqual({
      memberships: segmentCount,
      memberCount: segmentCount,
    });

    await client.contacts.adjustScore({ contactId: contact.id, delta: -60, reason: "reset" });
    const removalStart = counted.count();
    await reconcileContactSegmentMemberships(
      createDatabase(counted.database),
      workspaceId,
      contact.id,
    );
    const removalRoundTrips = counted.count() - removalStart;
    expect(removalRoundTrips).toBe(5);
    expect(removalRoundTrips).toBeLessThanOrEqual(maxRoundTrips);
    expect(await membershipSummary(workspaceId, contact.id)).toEqual({
      memberships: 0,
      memberCount: 0,
    });
  });

  it("reconciles every definition above the former 1000-segment cap", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "over-cap-segments@example.com",
      customFields: {},
    });
    const segmentCount = 1_001;
    await insertManyDynamicSegments(workspaceId, segmentCount, {
      kind: "condition",
      field: "score",
      operator: "gte",
      value: 50,
    });
    await client.contacts.adjustScore({ contactId: contact.id, delta: 60, reason: "qualified" });
    const counted = countDatabaseRoundTrips(env.DB);

    await reconcileContactSegmentMemberships(
      createDatabase(counted.database),
      workspaceId,
      contact.id,
    );

    const maxRoundTrips = 1 + 2 * Math.ceil(segmentCount / 50);
    expect(counted.count()).toBe(43);
    expect(counted.count()).toBeLessThanOrEqual(maxRoundTrips);
    expect(await membershipSummary(workspaceId, contact.id)).toEqual({
      memberships: segmentCount,
      memberCount: segmentCount,
    });
  });

  it("updates member counts from the immediately preceding membership mutation", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "changes-delta@example.com",
      customFields: {},
    });
    await insertDynamicSegment("changes-delta", workspaceId, {
      kind: "condition",
      field: "score",
      operator: "gte",
      value: 50,
    });
    await client.contacts.adjustScore({ contactId: contact.id, delta: 60, reason: "qualified" });

    const insertion = capturePreparedQueries(env.DB);
    await reconcileContactSegmentMemberships(
      createDatabase(insertion.database),
      workspaceId,
      contact.id,
    );
    expectChangesUpdateAfterMutation(insertion.queries, "insert");

    await setSegmentEvaluationSentinel(workspaceId, "changes-delta", "matched-no-op");
    await reconcileContactSegmentMemberships(createDatabase(env.DB), workspaceId, contact.id);
    await expect(segmentEvaluationState(workspaceId, "changes-delta")).resolves.toEqual({
      memberCount: 1,
      evaluatedAt: "2026-08-25T01:00:00.000Z",
      evaluationStatus: "failed",
      evaluationError: "matched-no-op",
      updatedAt: "2026-08-25T02:00:00.000Z",
    });

    await client.contacts.adjustScore({ contactId: contact.id, delta: -60, reason: "reset" });
    const removal = capturePreparedQueries(env.DB);
    await reconcileContactSegmentMemberships(
      createDatabase(removal.database),
      workspaceId,
      contact.id,
    );
    expectChangesUpdateAfterMutation(removal.queries, "delete");

    await setSegmentEvaluationSentinel(workspaceId, "changes-delta", "unmatched-no-op");
    await reconcileContactSegmentMemberships(createDatabase(env.DB), workspaceId, contact.id);
    await expect(segmentEvaluationState(workspaceId, "changes-delta")).resolves.toEqual({
      memberCount: 0,
      evaluatedAt: "2026-08-25T01:00:00.000Z",
      evaluationStatus: "failed",
      evaluationError: "unmatched-no-op",
      updatedAt: "2026-08-25T02:00:00.000Z",
    });
  });

  it("leaves a static membership untouched by dynamic delta reconciliation", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const contact = await client.contacts.create({
      email: "static-membership@example.com",
      customFields: {},
    });
    await insertDynamicSegment("static-membership", workspaceId, {
      kind: "condition",
      field: "score",
      operator: "gte",
      value: 50,
    });
    await env.DB.prepare(
      `INSERT INTO segment_memberships
         (workspace_id, segment_id, contact_id, source, joined_at)
       VALUES (?, 'static-membership', ?, 'static', '2026-08-25T00:00:00.000Z')`,
    )
      .bind(workspaceId, contact.id)
      .run();
    await env.DB.prepare(
      "UPDATE segments SET member_count = 1 WHERE workspace_id = ? AND id = 'static-membership'",
    )
      .bind(workspaceId)
      .run();

    await client.contacts.adjustScore({ contactId: contact.id, delta: 60, reason: "qualified" });
    await reconcileContactSegmentMemberships(createDatabase(env.DB), workspaceId, contact.id);
    await client.contacts.adjustScore({ contactId: contact.id, delta: -60, reason: "reset" });
    await reconcileContactSegmentMemberships(createDatabase(env.DB), workspaceId, contact.id);

    const row = await env.DB.prepare(
      `SELECT sm.source, s.member_count AS memberCount
       FROM segment_memberships sm
       JOIN segments s ON s.workspace_id = sm.workspace_id AND s.id = sm.segment_id
       WHERE sm.workspace_id = ? AND sm.segment_id = 'static-membership'
         AND sm.contact_id = ?`,
    )
      .bind(workspaceId, contact.id)
      .first<{ source: string; memberCount: number }>();
    expect(row).toEqual({ source: "static", memberCount: 1 });
  });
});

type SegmentFilterInput = Parameters<typeof compileSegmentFilter>[1];

async function insertDynamicSegments(
  workspaceId: string,
  count: number,
  filter: SegmentFilterInput,
): Promise<void> {
  await env.DB.batch(
    Array.from({ length: count }, (_, index) => {
      const id = `batched-segment-${String(index).padStart(3, "0")}`;
      return dynamicSegmentInsert().bind(id, workspaceId, id, JSON.stringify(filter));
    }),
  );
}

async function insertManyDynamicSegments(
  workspaceId: string,
  count: number,
  filter: SegmentFilterInput,
): Promise<void> {
  await env.DB.prepare(
    `WITH digits(value) AS (
       VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9)
     ), numbers(value) AS (
       SELECT ones.value + tens.value * 10 + hundreds.value * 100 + thousands.value * 1000
       FROM digits ones CROSS JOIN digits tens CROSS JOIN digits hundreds CROSS JOIN digits thousands
     )
     INSERT INTO segments (
       id, workspace_id, name, slug, description, kind, filter_ast,
       membership_source, filter_version, member_count, evaluated_at,
       evaluation_status, evaluation_error, created_at, updated_at
     )
     SELECT 'over-cap-segment-' || printf('%04d', value), ?,
            'Over cap segment ' || value, 'over-cap-segment-' || printf('%04d', value),
            '', 'dynamic', ?, NULL, 1, 0, NULL, 'ready', NULL,
            '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'
     FROM numbers WHERE value < ?`,
  )
    .bind(workspaceId, JSON.stringify(filter), count)
    .run();
}

async function insertDynamicSegment(
  id: string,
  workspaceId: string,
  filter: SegmentFilterInput,
): Promise<void> {
  await dynamicSegmentInsert().bind(id, workspaceId, id, JSON.stringify(filter)).run();
}

function dynamicSegmentInsert(): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO segments (
       id, workspace_id, name, slug, description, kind, filter_ast,
       membership_source, filter_version, member_count, evaluated_at,
       evaluation_status, evaluation_error, created_at, updated_at
     ) VALUES (?, ?, 'Dynamic segment', ?, '', 'dynamic', ?, NULL, 1, 0, NULL, 'ready', NULL,
       '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z')`,
  );
}

async function membershipSummary(
  workspaceId: string,
  contactId: string,
): Promise<{ memberships: number; memberCount: number }> {
  const [memberships, memberCount] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM segment_memberships WHERE workspace_id = ? AND contact_id = ?",
    )
      .bind(workspaceId, contactId)
      .first<{ count: number }>(),
    env.DB.prepare(
      "SELECT COALESCE(SUM(member_count), 0) AS memberCount FROM segments WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first<{ memberCount: number }>(),
  ]);
  return {
    memberships: Number(memberships?.count ?? 0),
    memberCount: Number(memberCount?.memberCount ?? 0),
  };
}

function countDatabaseRoundTrips(source: D1Database): {
  database: D1Database;
  count: () => number;
} {
  let roundTrips = 0;
  const rawStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values));
        }
        if (
          property === "all" ||
          property === "first" ||
          property === "run" ||
          property === "raw"
        ) {
          return (...args: unknown[]) => {
            roundTrips += 1;
            const method = Reflect.get(target, property, target) as (
              ...values: unknown[]
            ) => unknown;
            return method.apply(target, args);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    rawStatements.set(wrapped, statement);
    return wrapped;
  };

  return {
    database: new Proxy(source, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            roundTrips += 1;
            return target.batch(
              statements.map((statement) => rawStatements.get(statement) ?? statement),
            );
          };
        }
        if (property === "prepare") {
          return (query: string) => wrapStatement(target.prepare(query));
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    count: () => roundTrips,
  };
}

function capturePreparedQueries(source: D1Database): {
  database: D1Database;
  queries: string[];
} {
  const queries: string[] = [];
  return {
    database: new Proxy(source, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            queries.push(query);
            return target.prepare(query);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    queries,
  };
}

function expectChangesUpdateAfterMutation(
  queries: readonly string[],
  mutation: "insert" | "delete",
): void {
  const normalized = queries.map((query) => query.toLowerCase());
  const mutationPrefix =
    mutation === "insert"
      ? 'insert into "segment_memberships"'
      : 'delete from "segment_memberships"';
  const mutationIndex = normalized.findIndex((query) => query.includes(mutationPrefix));
  const updateIndex = normalized.findIndex((query) =>
    query.includes('update "segments" set "member_count"'),
  );
  expect(mutationIndex).toBeGreaterThanOrEqual(0);
  expect(updateIndex).toBeGreaterThan(mutationIndex);
  expect(normalized[updateIndex]).toContain("changes()");
}

async function setSegmentEvaluationSentinel(
  workspaceId: string,
  segmentId: string,
  error: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE segments
     SET evaluated_at = '2026-08-25T01:00:00.000Z', evaluation_status = 'failed',
         evaluation_error = ?, updated_at = '2026-08-25T02:00:00.000Z'
     WHERE workspace_id = ? AND id = ?`,
  )
    .bind(error, workspaceId, segmentId)
    .run();
}

async function segmentEvaluationState(workspaceId: string, segmentId: string) {
  return env.DB.prepare(
    `SELECT member_count AS memberCount, evaluated_at AS evaluatedAt,
            evaluation_status AS evaluationStatus, evaluation_error AS evaluationError,
            updated_at AS updatedAt
     FROM segments WHERE workspace_id = ? AND id = ?`,
  )
    .bind(workspaceId, segmentId)
    .first();
}
