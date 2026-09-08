import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { projectCloneListInputSchema } from "@openengage/core/projects";
import { createDatabase } from "@openengage/database/client";
import { ProjectCloneQueryRepository } from "@openengage/database/projects";
import { projectCloneJobs, projectCloneMappings } from "@openengage/database/testing";

import { seedWorkspaceContext } from "./factory";
import { observeQueries } from "./query-observer";
async function fixture() {
  const workspace = await seedWorkspaceContext(env.DB, "clone-reads");
  const database = createDatabase(env.DB);
  for (let index = 0; index < 45; index++) {
    const id = `${workspace.workspaceId}-${String(index).padStart(3, "0")}`;
    const now = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    await database.orm.insert(projectCloneJobs).values({
      id,
      workspaceId: workspace.workspaceId,
      sourceProjectId: "source",
      targetProjectId: id,
      createdByUserId: workspace.userId,
      options: JSON.stringify({
        name: `Clone ${index}`,
        ownerUserId: null,
        approverUserId: null,
        reviewAt: null,
        variables: {},
      }),
      referenceMap: '{"ids":{},"segmentSlugs":{},"managedUrls":{}}',
      status: index < 25 ? "completed" : "preview",
      createdAt: now,
      updatedAt: now,
    });
    await database.orm.insert(projectCloneMappings).values({
      jobId: id,
      ordinal: 0,
      kind: "project",
      sourceId: "source",
      targetId: id,
      metadata: JSON.stringify({
        kind: "project",
        sourceId: "source",
        targetId: id,
        name: "Clone",
        sourceVersion: null,
        sourceSlug: null,
        targetSlug: null,
        linked: false,
      }),
      sourceRow: JSON.stringify({ padding: "s".repeat(50000) }),
      targetRow: JSON.stringify({ padding: "t".repeat(50000) }),
    });
  }
  return workspace;
}
describe("clone read projection", () => {
  it("keeps completed history visible behind twenty newer previews with one small query", async () => {
    const f = await fixture();
    const observed = observeQueries(env.DB);
    const start = performance.now();
    const result = await new ProjectCloneQueryRepository(observed.database, f).list("source");
    console.info(
      "CLONE_LIST_MEASUREMENT",
      JSON.stringify({ ...observed.metrics, sql: undefined, elapsedMs: performance.now() - start }),
    );
    const jobs = result.items;
    expect(jobs).toHaveLength(20);
    expect(observed.metrics.calls).toBe(1);
    expect(observed.metrics.resultBytes).toBeLessThan(20000);
  });
  it("does not transfer source or target snapshots when opening details", async () => {
    const f = await fixture();
    const observed = observeQueries(env.DB);
    const start = performance.now();
    const result = await new ProjectCloneQueryRepository(observed.database, f).get(
      `${f.workspaceId}-000`,
    );
    console.info(
      "CLONE_DETAIL_MEASUREMENT",
      JSON.stringify({ ...observed.metrics, sql: undefined, elapsedMs: performance.now() - start }),
    );
    expect(result?.resources).toHaveLength(1);
    expect(observed.metrics.resultBytes).toBeLessThan(2000);
    expect(observed.metrics.sql.join(" ")).not.toContain('"source_row"');
  });
});

it("pages a stable timestamp/id cursor, clamps page size and polls a single lightweight summary", async () => {
  const f = await fixture();
  await createDatabase(env.DB)
    .orm.update(projectCloneJobs)
    .set({ createdAt: "2026-01-01T00:00:00.000Z" })
    .where(eq(projectCloneJobs.workspaceId, f.workspaceId));
  expect(projectCloneListInputSchema.parse({}).limit).toBe(20);
  expect(() => projectCloneListInputSchema.parse({ limit: 101 })).toThrow();
  const repository = new ProjectCloneQueryRepository(env.DB, f);
  const ids: string[] = [];
  let cursor;
  do {
    const page = await repository.list("source", { limit: 7, ...(cursor ? { cursor } : {}) });
    expect(page.items.every((job) => job.status !== "preview")).toBe(true);
    ids.push(...page.items.map((job) => job.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toHaveLength(25);
  expect(new Set(ids).size).toBe(25);
  expect((await repository.list("source", { limit: 500 })).items).toHaveLength(25);
  const observed = observeQueries(env.DB);
  const started = performance.now();
  const progress = await new ProjectCloneQueryRepository(observed.database, f).progress(ids[0]!);
  console.info(
    "CLONE_PROGRESS_MEASUREMENT",
    JSON.stringify({ ...observed.metrics, sql: undefined, elapsedMs: performance.now() - started }),
  );
  expect(progress).toMatchObject({ preparedCount: 1, totalCount: 1 });
  expect(progress).not.toHaveProperty("options");
  expect(progress).not.toHaveProperty("resources");
  expect(observed.metrics.calls).toBe(1);
  expect(observed.metrics.resultBytes).toBeLessThan(1000);
  expect(observed.metrics.sql.join(" ")).not.toContain('"source_row"');
  const other = await seedWorkspaceContext(env.DB, "other-clone-reader");
  expect(await new ProjectCloneQueryRepository(env.DB, other).progress(ids[0]!)).toBeNull();
  expect(await new ProjectCloneQueryRepository(env.DB, other).get(ids[0]!)).toBeNull();
  expect((await new ProjectCloneQueryRepository(env.DB, other).list("source")).items).toEqual([]);
});
