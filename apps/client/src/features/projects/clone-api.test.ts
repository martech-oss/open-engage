import { QueryClient, type Query } from "@tanstack/react-query";
import { expect, it } from "vitest";

import { orpcQuery } from "@/lib/orpc";
import type { ProjectClonePage, ProjectCloneSummary } from "@openengage/core/projects";

import { projectCloneListQueryOptions, projectCloneProgressQueryOptions } from "./clone-api";

function job(status: ProjectCloneSummary["status"]): ProjectCloneSummary {
  return {
    id: "job",
    name: "Copy",
    sourceProjectId: "source",
    targetProjectId: "target",
    status,
    preparedCount: 1,
    totalCount: 2,
    error: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    completedAt: null,
  };
}
function interval<T>(option: unknown, query: Query<T>): unknown {
  expect(typeof option).toBe("function");
  return typeof option === "function" ? option(query) : undefined;
}

it.each([
  ["queued", 3000, 2000],
  ["running", 3000, 2000],
  ["preview", false, false],
  ["completed", false, false],
  ["failed", false, false],
] as const)(
  "polls %s clone summaries only while work is active",
  (status, listInterval, progressInterval) => {
    const client = new QueryClient();
    const list = projectCloneListQueryOptions("source");
    const progress = projectCloneProgressQueryOptions("source", "job");
    const listQuery = client
      .getQueryCache()
      .build<ProjectClonePage>(client, { queryKey: list.queryKey });
    const progressQuery = client
      .getQueryCache()
      .build<ProjectCloneSummary>(client, { queryKey: progress.queryKey });
    listQuery.setData({ items: [job(status)], nextCursor: null });
    progressQuery.setData(job(status));
    expect(interval(list.refetchInterval, listQuery)).toBe(listInterval);
    expect(interval(progress.refetchInterval, progressQuery)).toBe(progressInterval);
    client.clear();
  },
);

it("does not poll absent data and disables progress before a job is selected", () => {
  const client = new QueryClient();
  const list = projectCloneListQueryOptions("source");
  const progress = projectCloneProgressQueryOptions("source", "");
  expect(progress.enabled).toBe(false);
  expect(projectCloneProgressQueryOptions("source", "job").enabled).toBe(true);
  expect(
    interval(
      list.refetchInterval,
      client.getQueryCache().build<ProjectClonePage>(client, { queryKey: list.queryKey }),
    ),
  ).toBe(false);
  expect(
    interval(
      progress.refetchInterval,
      client.getQueryCache().build<ProjectCloneSummary>(client, { queryKey: progress.queryKey }),
    ),
  ).toBe(false);
  client.clear();
});

it("retains both typed cursor fields and project identity in existing query keys", () => {
  const cursor = { id: "job", createdAt: "2026-01-01T01:02:03.456Z" };
  expect(projectCloneListQueryOptions("source", cursor).queryKey).toEqual(
    orpcQuery.projects.cloneList.queryOptions({ input: { id: "source", cursor } }).queryKey,
  );
  expect(projectCloneListQueryOptions("source").queryKey).toEqual(
    orpcQuery.projects.cloneList.queryOptions({ input: { id: "source" } }).queryKey,
  );
  expect(projectCloneProgressQueryOptions("source", "job").queryKey).toEqual(
    orpcQuery.projects.cloneProgress.queryOptions({ input: { id: "source", jobId: "job" } })
      .queryKey,
  );
});

it("keeps polling a mixed history page while any clone runs and stops on an empty page", () => {
  const client = new QueryClient();
  const options = projectCloneListQueryOptions("source");
  const query = client
    .getQueryCache()
    .build<ProjectClonePage>(client, { queryKey: options.queryKey });
  query.setData({ items: [job("failed"), job("running")], nextCursor: null });
  expect(interval(options.refetchInterval, query)).toBe(3000);
  query.setData({ items: [], nextCursor: null });
  expect(interval(options.refetchInterval, query)).toBe(false);
  client.clear();
});
