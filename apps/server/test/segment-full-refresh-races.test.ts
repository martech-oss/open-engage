import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "@openengage/database/testing";

import { refreshSegmentMemberships } from "../src/segments/membership-service";
import { seedWorkspaceClient } from "./factory";

const REPLACEMENT_EVALUATED_AT = "2026-08-26T01:00:00.000Z";
const REPLACEMENT_UPDATED_AT = "2026-08-26T02:00:00.000Z";

describe("full segment refresh definition guards", () => {
  it("does not mark or populate a dynamic definition replaced after its read", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const email = "dynamic-refresh-race@example.com";
    const segment = await client.segments.create({
      name: "Dynamic refresh race",
      slug: "dynamic-refresh-race",
      kind: "dynamic",
      filter: { kind: "condition", field: "email", operator: "eq", value: email },
    });
    await client.contacts.create({
      email,
      customFields: {},
    });
    const raced = beforePreparedExecution(
      env.DB,
      (query) => query.toLowerCase().startsWith('update "segments" set "evaluation_status"'),
      () => replaceDefinition(segment.id, "dynamic"),
    );

    await expect(
      refreshSegmentMemberships(createDatabase(raced), workspaceId, segment.id),
    ).resolves.toBe(true);

    await expect(segmentState(workspaceId, segment.id)).resolves.toEqual({
      kind: "dynamic",
      filterVersion: 2,
      memberCount: 77,
      evaluatedAt: REPLACEMENT_EVALUATED_AT,
      evaluationStatus: "pending",
      evaluationError: "replacement-definition",
      updatedAt: REPLACEMENT_UPDATED_AT,
      memberships: 0,
    });
  });

  it("does not count a static definition replaced after its read", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const segment = await client.segments.create({
      name: "Static refresh race",
      slug: "static-refresh-race",
      kind: "static",
      membershipSource: "Manual selection",
    });
    const raced = beforePreparedExecution(
      env.DB,
      (query) => query.toLowerCase().startsWith('update "segments" set "member_count"'),
      () => replaceDefinition(segment.id, "dynamic"),
    );

    await expect(
      refreshSegmentMemberships(createDatabase(raced), workspaceId, segment.id),
    ).resolves.toBe(true);

    await expect(segmentState(workspaceId, segment.id)).resolves.toEqual({
      kind: "dynamic",
      filterVersion: 2,
      memberCount: 77,
      evaluatedAt: REPLACEMENT_EVALUATED_AT,
      evaluationStatus: "pending",
      evaluationError: "replacement-definition",
      updatedAt: REPLACEMENT_UPDATED_AT,
      memberships: 0,
    });
  });

  it("does not mark a replacement failed when the superseded refresh throws", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const segment = await client.segments.create({
      name: "Failed refresh race",
      slug: "failed-refresh-race",
      kind: "dynamic",
      filter: { kind: "condition", field: "status", operator: "eq", value: "active" },
    });
    const definition = await client.segments.get({ id: segment.id });
    const failure = new Error("replacement batch failed");
    const raced = failBeforeDatabaseBatch(env.DB, failure, () =>
      replaceDefinition(segment.id, "dynamic"),
    );

    await expect(
      refreshSegmentMemberships(
        createDatabase(raced),
        workspaceId,
        segment.id,
        definition.filterVersion,
      ),
    ).rejects.toBe(failure);

    await expect(segmentState(workspaceId, segment.id)).resolves.toEqual({
      kind: "dynamic",
      filterVersion: 2,
      memberCount: 77,
      evaluatedAt: REPLACEMENT_EVALUATED_AT,
      evaluationStatus: "pending",
      evaluationError: "replacement-definition",
      updatedAt: REPLACEMENT_UPDATED_AT,
      memberships: 0,
    });
  });

  it("does not overwrite a completed same-version refresh with a late failure", async () => {
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const segment = await client.segments.create({
      name: "Duplicate refresh race",
      slug: "duplicate-refresh-race",
      kind: "dynamic",
      filter: { kind: "condition", field: "status", operator: "eq", value: "active" },
    });
    const definition = await client.segments.get({ id: segment.id });
    const failure = new Error("late duplicate batch failed");
    const raced = failBeforeDatabaseBatch(env.DB, failure, () =>
      completeCurrentDefinition(segment.id),
    );

    await expect(
      refreshSegmentMemberships(
        createDatabase(raced),
        workspaceId,
        segment.id,
        definition.filterVersion,
      ),
    ).rejects.toBe(failure);

    await expect(segmentState(workspaceId, segment.id)).resolves.toEqual({
      kind: "dynamic",
      filterVersion: definition.filterVersion,
      memberCount: 77,
      evaluatedAt: REPLACEMENT_EVALUATED_AT,
      evaluationStatus: "ready",
      evaluationError: null,
      updatedAt: REPLACEMENT_UPDATED_AT,
      memberships: 0,
    });
  });
});

it("freezes membership deltas before transition events can change an event filter", async () => {
  const { client, workspaceId } = await seedWorkspaceClient(env.DB);
  const contact = await client.contacts.create({
    email: "no-joined-event@example.com",
    customFields: {},
  });
  const segment = await client.segments.create({
    name: "No prior join",
    slug: "no-prior-join",
    kind: "dynamic",
    filter: {
      kind: "group",
      relation: "event",
      combinator: "and",
      negated: true,
      children: [
        { kind: "condition", field: "event_type", operator: "eq", value: "segment_joined" },
      ],
    },
  });
  expect(
    await env.DB.prepare(
      "SELECT contact_id FROM segment_memberships WHERE workspace_id=? AND segment_id=?",
    )
      .bind(workspaceId, segment.id)
      .all(),
  ).toMatchObject({ results: [{ contact_id: contact.id }] });
  expect(
    await env.DB.prepare("SELECT type FROM contact_events WHERE workspace_id=? AND resource_id=?")
      .bind(workspaceId, segment.id)
      .all(),
  ).toMatchObject({ results: [{ type: "segment_joined" }] });
  await refreshSegmentMemberships(createDatabase(env.DB), workspaceId, segment.id);
  expect(
    (
      await env.DB.prepare(
        "SELECT contact_id FROM segment_memberships WHERE workspace_id=? AND segment_id=?",
      )
        .bind(workspaceId, segment.id)
        .all()
    ).results,
  ).toHaveLength(0);
  const events = await env.DB.prepare(
    "SELECT type FROM contact_events WHERE workspace_id=? AND resource_id=? ORDER BY id",
  )
    .bind(workspaceId, segment.id)
    .all();
  expect(events.results).toEqual([{ type: "segment_joined" }, { type: "segment_left" }]);
  await refreshSegmentMemberships(createDatabase(env.DB), workspaceId, segment.id);
  expect(
    (
      await env.DB.prepare("SELECT id FROM contact_events WHERE workspace_id=? AND resource_id=?")
        .bind(workspaceId, segment.id)
        .all()
    ).results,
  ).toHaveLength(2);
});

async function replaceDefinition(id: string, kind: "dynamic" | "static"): Promise<void> {
  await env.DB.prepare(
    `UPDATE segments
     SET kind = ?, filter_version = 2, member_count = 77,
         evaluated_at = ?, evaluation_status = 'pending',
         evaluation_error = 'replacement-definition', updated_at = ?
     WHERE id = ?`,
  )
    .bind(kind, REPLACEMENT_EVALUATED_AT, REPLACEMENT_UPDATED_AT, id)
    .run();
}

async function completeCurrentDefinition(id: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE segments
     SET member_count = 77, evaluated_at = ?, evaluation_status = 'ready',
         evaluation_error = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(REPLACEMENT_EVALUATED_AT, REPLACEMENT_UPDATED_AT, id)
    .run();
}

async function segmentState(workspaceId: string, segmentId: string) {
  const state = await env.DB.prepare(
    `SELECT kind, filter_version AS filterVersion, member_count AS memberCount,
            evaluated_at AS evaluatedAt, evaluation_status AS evaluationStatus,
            evaluation_error AS evaluationError, updated_at AS updatedAt,
            (SELECT COUNT(*) FROM segment_memberships sm
             WHERE sm.workspace_id = segments.workspace_id AND sm.segment_id = segments.id)
              AS memberships
     FROM segments WHERE workspace_id = ? AND id = ?`,
  )
    .bind(workspaceId, segmentId)
    .first();
  return state;
}

function beforePreparedExecution(
  source: D1Database,
  matches: (query: string) => boolean,
  barrier: () => Promise<void>,
): D1Database {
  let triggered = false;
  const wrap = (statement: D1PreparedStatement, query: string): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(target.bind(...values), query);
        }
        if (
          !triggered &&
          matches(query) &&
          (property === "run" || property === "all" || property === "first" || property === "raw")
        ) {
          return async (...args: unknown[]) => {
            triggered = true;
            await barrier();
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
  return new Proxy(source, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrap(target.prepare(query), query);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function failBeforeDatabaseBatch(
  source: D1Database,
  failure: Error,
  barrier: () => Promise<void>,
): D1Database {
  return new Proxy(source, {
    get(target, property) {
      if (property === "batch") {
        return async () => {
          await barrier();
          throw failure;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
