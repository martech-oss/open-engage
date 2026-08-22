import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { ContactExportFilter } from "@openengage/core/contacts";
import {
  companies,
  companyContacts,
  contacts,
  contactTags,
  createDatabase,
  importJobs,
  segmentMemberships,
  segments,
  tags,
  uuidv7,
} from "@openengage/database/testing";
import type { WorkspaceContext } from "@openengage/orpc";

import { getContactExportFile, startContactExport } from "../src/contacts/import-export-service";
import { processContactExport } from "../src/contacts/worker";
import type { RuntimeEnv } from "../src/env";
import { seedWorkspaceContext } from "./factory";

const runtimeEnv = env as RuntimeEnv;

describe("contact export jobs", () => {
  it("exports every workspace contact when the optional filter is omitted and keeps CSV cells safe", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "export-all");
    const otherWorkspace = await seedWorkspaceContext(env.DB, "export-hidden");
    const now = "2026-08-23T00:00:00.000Z";
    await createDatabase(env.DB)
      .orm.insert(contacts)
      .values([
        contactRow(workspace.workspaceId, "all-active", {
          email: "active@example.com",
          firstName: 'Ada "Quoted",\nLine',
          externalId: "=2+2",
        }),
        contactRow(workspace.workspaceId, "all-archived", {
          email: "archived@example.com",
          status: "archived",
          archivedAt: now,
        }),
        contactRow(otherWorkspace.workspaceId, "all-hidden", {
          email: "hidden@example.com",
        }),
      ]);

    const { jobId } = await startContactExport(createDatabase(env.DB), env.JOBS_QUEUE, workspace);
    await expect(
      getContactExportFile(createDatabase(env.DB), env.ASSETS_BUCKET, workspace.workspaceId, jobId),
    ).resolves.toEqual({ kind: "not_ready" });

    await processContactExport(jobId, runtimeEnv);

    const csv = await completedCsv(workspace, jobId);
    expect(csv).toContain('"all-active","active@example.com","Ada ""Quoted"",\nLine"');
    expect(csv).toContain('"\'=2+2"');
    expect(csv).toContain('"all-archived","archived@example.com"');
    expect(csv).not.toContain("all-hidden");
  });

  it("applies every export filter alone and in combination without crossing workspaces", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "export-filters");
    const otherWorkspace = await seedWorkspaceContext(env.DB, "export-filter-hidden");
    const fixture = await seedFilterFixture(workspace, otherWorkspace);
    const cases: Array<[string, ContactExportFilter, string[]]> = [
      ["query", { query: "needle" }, [fixture.targetId]],
      ["status", { status: "archived" }, [fixture.archivedId]],
      ["stage", { stage: "customer" }, [fixture.targetId]],
      ["tag", { tagId: fixture.tagId }, [fixture.targetId]],
      ["company", { companyId: fixture.companyId }, [fixture.targetId]],
      ["segment", { segmentId: fixture.segmentId }, [fixture.targetId]],
      ["minimum score", { scoreMin: 60 }, [fixture.highScoreId]],
      ["maximum score", { scoreMax: 0 }, [fixture.archivedId]],
      [
        "combined filters",
        {
          query: "needle",
          status: "active",
          stage: "customer",
          tagId: fixture.tagId,
          companyId: fixture.companyId,
          segmentId: fixture.segmentId,
          scoreMin: 50,
          scoreMax: 50,
        },
        [fixture.targetId],
      ],
      [
        "explicit all status",
        { status: "all" },
        [fixture.archivedId, fixture.highScoreId, fixture.targetId].sort(),
      ],
    ];

    for (const [label, filter, expectedIds] of cases) {
      const { jobId } = await startContactExport(
        createDatabase(env.DB),
        env.JOBS_QUEUE,
        workspace,
        { filter },
      );
      await processContactExport(jobId, runtimeEnv);
      expect({ label, ids: csvIds(await completedCsv(workspace, jobId)) }).toEqual({
        label,
        ids: expectedIds,
      });
    }
  });

  it("resumes ID-ascending pagination beyond 1,000 rows with the normalized filter snapshot intact", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "export-resume");
    const database = createDatabase(env.DB);
    const values = Array.from({ length: 1_001 }, (_, index) =>
      contactRow(workspace.workspaceId, `bulk-${String(index).padStart(4, "0")}`, {
        email: `bulk-${index}@example.com`,
      }),
    );
    values.splice(
      501,
      0,
      contactRow(workspace.workspaceId, "bulk-0500-z-archived", {
        email: "bulk-archived@example.com",
        status: "archived",
        archivedAt: "2026-08-23T00:00:00.000Z",
      }),
    );
    for (let offset = 0; offset < values.length; offset += 5) {
      await database.orm.insert(contacts).values(values.slice(offset, offset + 5));
    }

    const { jobId } = await startContactExport(database, env.JOBS_QUEUE, workspace, {
      filter: { status: "active", query: "  bulk-  " },
    });
    await processContactExport(jobId, runtimeEnv);

    const afterFirstPage = await database.orm
      .select({
        status: importJobs.status,
        cursor: importJobs.cursor,
        processed: importJobs.processed,
      })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .get();
    expect(afterFirstPage).toEqual({
      status: "processing",
      processed: 1_000,
      cursor: JSON.stringify({
        partNumber: 1,
        lastId: "bulk-0999",
        filter: { query: "bulk-", status: "active" },
      }),
    });

    await processContactExport(jobId, runtimeEnv);

    const ids = csvIds(await completedCsv(workspace, jobId));
    expect(ids).toHaveLength(1_001);
    expect(ids.slice(0, 2)).toEqual(["bulk-0000", "bulk-0001"]);
    expect(ids.at(-1)).toBe("bulk-1000");
    expect(ids).not.toContain("bulk-0500-z-archived");
    await expect(
      database.orm
        .select({ status: importJobs.status, processed: importJobs.processed })
        .from(importJobs)
        .where(eq(importJobs.id, jobId))
        .get(),
    ).resolves.toEqual({ status: "completed", processed: 1_001 });
  });
});

function contactRow(
  workspaceId: string,
  id: string,
  overrides: Partial<typeof contacts.$inferInsert> = {},
): typeof contacts.$inferInsert {
  const now = "2026-08-23T00:00:00.000Z";
  return {
    id,
    workspaceId,
    email: `${id}@example.com`,
    firstName: null,
    lastName: null,
    phone: null,
    externalId: null,
    stage: "lead",
    score: 0,
    status: "active",
    customFields: "{}",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

async function seedFilterFixture(workspace: WorkspaceContext, otherWorkspace: WorkspaceContext) {
  const database = createDatabase(env.DB);
  const targetId = "filter-target";
  const archivedId = "filter-archived";
  const highScoreId = "filter-high-score";
  const hiddenId = "filter-hidden";
  const tagId = uuidv7();
  const companyId = uuidv7();
  const segmentId = uuidv7();
  const now = "2026-08-23T00:00:00.000Z";
  await database.orm.batch([
    database.orm.insert(contacts).values(
      contactRow(workspace.workspaceId, targetId, {
        email: "needle@example.com",
        firstName: "Needle",
        stage: "customer",
        score: 50,
      }),
    ),
    database.orm.insert(contacts).values(
      contactRow(workspace.workspaceId, archivedId, {
        email: "archived@example.com",
        status: "archived",
        score: -10,
        archivedAt: now,
      }),
    ),
    database.orm.insert(contacts).values(
      contactRow(workspace.workspaceId, highScoreId, {
        email: "high@example.com",
        status: "anonymous",
        stage: "prospect",
        score: 90,
      }),
    ),
    database.orm.insert(contacts).values(
      contactRow(otherWorkspace.workspaceId, hiddenId, {
        email: "needle-hidden@example.com",
        stage: "customer",
        score: 50,
      }),
    ),
    database.orm.insert(tags).values({
      id: tagId,
      workspaceId: workspace.workspaceId,
      name: "Export tag",
      slug: "export-tag",
      createdAt: now,
    }),
    database.orm.insert(companies).values({
      id: companyId,
      workspaceId: workspace.workspaceId,
      name: "Export company",
      createdAt: now,
      updatedAt: now,
    }),
    database.orm.insert(segments).values({
      id: segmentId,
      workspaceId: workspace.workspaceId,
      name: "Export segment",
      slug: "export-segment",
      kind: "static",
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  await database.orm.batch([
    database.orm.insert(contactTags).values({
      workspaceId: workspace.workspaceId,
      contactId: targetId,
      tagId,
      createdAt: now,
    }),
    database.orm.insert(companyContacts).values({
      workspaceId: workspace.workspaceId,
      contactId: targetId,
      companyId,
      createdAt: now,
    }),
    database.orm.insert(segmentMemberships).values({
      workspaceId: workspace.workspaceId,
      contactId: targetId,
      segmentId,
      source: "static",
      joinedAt: now,
    }),
  ]);
  return { targetId, archivedId, highScoreId, tagId, companyId, segmentId };
}

async function completedCsv(workspace: WorkspaceContext, jobId: string): Promise<string> {
  const outcome = await getContactExportFile(
    createDatabase(env.DB),
    env.ASSETS_BUCKET,
    workspace.workspaceId,
    jobId,
  );
  expect(outcome.kind).toBe("ready");
  if (outcome.kind !== "ready") throw new Error("Expected completed export");
  return outcome.file.text();
}

function csvIds(csv: string): string[] {
  return csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => /^"([^"]+)"/.exec(line)?.[1] ?? "");
}
