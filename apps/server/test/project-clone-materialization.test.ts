import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { createDatabase } from "@openengage/database/client";
import { ProjectCloneMaterializationRepository } from "@openengage/database/projects";
import { projectCloneJobs, projectCloneMappings, projects } from "@openengage/database/testing";

import { seedWorkspaceClient } from "./factory";
it("fences expired or replaced leases before any final resource writes", async () => {
  const f = await seedWorkspaceClient(env.DB);
  const source = await f.client.projects.create({ name: "Source" });
  const preview = await f.client.projects.clonePreview({
    id: source.id,
    options: { name: "Copy" },
  });
  const database = createDatabase(env.DB);
  const mapping = await database.orm
    .select()
    .from(projectCloneMappings)
    .where(eq(projectCloneMappings.jobId, preview.id))
    .get();
  const row = { ...JSON.parse(mapping!.sourceRow), id: preview.targetProjectId, name: "Copy" };
  await database.orm
    .update(projectCloneMappings)
    .set({ targetRow: JSON.stringify(row) })
    .where(eq(projectCloneMappings.jobId, preview.id));
  await database.orm
    .update(projectCloneJobs)
    .set({ status: "running", leaseId: "old", leaseUntil: "2000-01-01T00:00:00.000Z" })
    .where(eq(projectCloneJobs.id, preview.id));
  const repository = new ProjectCloneMaterializationRepository(database, f);
  await expect(repository.materialize(preview.id, "old")).rejects.toThrow();
  await database.orm
    .update(projectCloneJobs)
    .set({ leaseId: "new", leaseUntil: "2100-01-01T00:00:00.000Z" })
    .where(eq(projectCloneJobs.id, preview.id));
  await expect(repository.materialize(preview.id, "old")).rejects.toThrow();
  expect(
    await database.orm
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, f.workspaceId), eq(projects.id, preview.targetProjectId)))
      .get(),
  ).toBeUndefined();
  await repository.materialize(preview.id, "new");
  expect(await f.client.projects.cloneProgress({ id: source.id, jobId: preview.id })).toMatchObject(
    { status: "completed", preparedCount: 1, totalCount: 1, name: "Copy" },
  );
  expect(await f.client.projects.cloneList({ id: source.id, limit: 1 })).toMatchObject({
    items: [{ id: preview.id }],
    nextCursor: null,
  });
});
