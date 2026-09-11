import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";

import { emptyLandingPageDocument } from "@openengage/core/web";
import { createDatabase } from "@openengage/database/client";
import { LandingGenerationRepository } from "@openengage/database/web";

import type { RuntimeEnv } from "../src/env";
import {
  processLandingGeneration,
  queueLandingGeneration,
  recoverLandingGenerations,
  retryLandingGeneration,
} from "../src/web/landing-generation-service";
import { seedWorkspaceClient } from "./factory";

it("retries a failed request explicitly with the same durable job and rejects stale or foreign retries", async () => {
  const { client } = await seedWorkspaceClient(env.DB),
    other = await seedWorkspaceClient(env.DB);
  const page = await client.website.createPage({
    name: "Retry",
    slug: "retry",
    document: emptyLandingPageDocument(),
  });
  const request = {
    pageId: page.id,
    baseVersionId: page.versionId,
    prompt: "Improve",
    requestKey: crypto.randomUUID(),
  };
  const job = await client.website.generatePage(request);
  await processLandingGeneration(job.id, env as unknown as RuntimeEnv, async () => {
    throw new Error("Provider timeout");
  });
  const failed = await client.website.getPageDesign({ id: page.id });
  expect(failed.jobs[0]).toMatchObject({ status: "failed", retryable: true });
  expect(failed.currentVersionId).toBe(page.versionId);
  await expect(
    other.client.website.retryPageGeneration({ pageId: page.id, jobId: job.id }),
  ).rejects.toThrow();
  await Promise.all([
    client.website.retryPageGeneration({ pageId: page.id, jobId: job.id }),
    client.website.retryPageGeneration({ pageId: page.id, jobId: job.id }),
  ]);
  const queued = await client.website.getPageDesign({ id: page.id });
  expect(queued.jobs).toHaveLength(1);
  expect(queued.jobs[0]).toMatchObject({ id: job.id, status: "queued" });
  expect(
    (await new LandingGenerationRepository(createDatabase(env.DB)).pending()).map((row) => row.id),
  ).toContain(job.id);
  await processLandingGeneration(job.id, env as unknown as RuntimeEnv, async () => ({
    document: emptyLandingPageDocument("Recovered"),
    explanation: "Recovered",
    imageRequests: [],
  }));
  const completed = await client.website.getPageDesign({ id: page.id });
  expect(completed.jobs[0]?.status).toBe("completed");
  expect(completed.versions).toHaveLength(2);
  const stale = await client.website.generatePage({
    ...request,
    baseVersionId: completed.currentVersionId!,
    requestKey: crypto.randomUUID(),
  });
  await processLandingGeneration(stale.id, env as unknown as RuntimeEnv, async () => {
    throw new Error("Temporary");
  });
  await client.website.updatePage({
    id: page.id,
    name: "Newer",
    slug: "retry",
    status: "draft",
    baseVersionId: completed.currentVersionId!,
    document: emptyLandingPageDocument("Newer"),
  });
  await expect(
    client.website.retryPageGeneration({ pageId: page.id, jobId: stale.id }),
  ).rejects.toMatchObject({ code: "PAGE_CONFLICT" });
});

it("does not retry a generated document with invalid references", async () => {
  const { client } = await seedWorkspaceClient(env.DB);
  const page = await client.website.createPage({
    name: "Invalid",
    document: emptyLandingPageDocument(),
  });
  const job = await client.website.generatePage({
    pageId: page.id,
    baseVersionId: page.versionId,
    prompt: "Invalid ref",
    requestKey: crypto.randomUUID(),
  });
  await processLandingGeneration(job.id, env as unknown as RuntimeEnv, async () => ({
    document: {
      ...emptyLandingPageDocument(),
      measurement: { projectId: "missing", primaryConversion: "form_submitted" },
    },
    explanation: "Invalid",
    imageRequests: [],
  }));
  expect((await client.website.getPageDesign({ id: page.id })).jobs[0]).toMatchObject({
    status: "failed",
    retryable: false,
    failureKind: "configuration",
  });
  await expect(
    client.website.retryPageGeneration({ pageId: page.id, jobId: job.id }),
  ).rejects.toMatchObject({ code: "PAGE_CONFLICT" });
});

it("recovers durable generation and retry requests when sending to the queue fails", async () => {
  const fixture = await seedWorkspaceClient(env.DB);
  const { client, workspaceId, userId } = fixture;
  const workspace = { workspaceId, userId, role: "marketer" as const };
  const database = createDatabase(env.DB);
  const send = vi
    .fn<RuntimeEnv["JOBS_QUEUE"]["send"]>()
    .mockRejectedValue(new Error("Queue unavailable"));
  const sendBatch = vi.fn<RuntimeEnv["JOBS_QUEUE"]["sendBatch"]>().mockResolvedValue(undefined);
  const unavailableQueueEnv = {
    ...env,
    JOBS_QUEUE: { send, sendBatch },
  } as unknown as RuntimeEnv;
  const page = await client.website.createPage({ name: "Recovery" });
  const queued = await queueLandingGeneration(database, workspace, unavailableQueueEnv, {
    pageId: page.id,
    baseVersionId: page.versionId,
    prompt: "Recover this draft",
    requestKey: crypto.randomUUID(),
  });
  if (queued.kind !== "ok") throw new Error("Expected durable queue request");
  expect(queued.job.status).toBe("queued");
  expect(send).toHaveBeenCalledWith({ kind: "landing_generation", jobId: queued.job.id });
  await recoverLandingGenerations(unavailableQueueEnv);
  expect(sendBatch).toHaveBeenLastCalledWith(
    expect.arrayContaining([{ body: { kind: "landing_generation", jobId: queued.job.id } }]),
  );
  await processLandingGeneration(queued.job.id, unavailableQueueEnv, async () => {
    throw new Error("Temporary provider failure");
  });
  await expect(
    retryLandingGeneration(database, workspace, unavailableQueueEnv, {
      pageId: page.id,
      jobId: queued.job.id,
    }),
  ).resolves.toBe("ok");
  sendBatch.mockClear();
  await recoverLandingGenerations(unavailableQueueEnv);
  expect(sendBatch).toHaveBeenCalledWith(
    expect.arrayContaining([{ body: { kind: "landing_generation", jobId: queued.job.id } }]),
  );
  const design = await client.website.getPageDesign({ id: page.id });
  expect(design.jobs).toHaveLength(1);
  expect(design.jobs[0]).toMatchObject({ id: queued.job.id, status: "queued" });
  expect(design.currentVersionId).toBe(page.versionId);
});
