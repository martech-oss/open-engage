import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "@openengage/database/testing";

import { PermanentChannelError } from "../src/channels";
import { getDataJob, startContactExport } from "../src/contacts/import-export-service";
import { processContactExport } from "../src/contacts/worker";
import type { RuntimeEnv } from "../src/env";
import { seedWorkspaceContext } from "./factory";

const runtimeEnv = env as RuntimeEnv;

describe("contact export cursor leases", () => {
  it("completes more than five successful pages because attempts reset per cursor", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "export-large");
    const database = createDatabase(env.DB);
    await seedGeneratedContacts(workspace.workspaceId, "large", 5_001);
    const { jobId } = await startContactExport(database, env.JOBS_QUEUE, workspace);

    for (let page = 0; page < 6; page += 1) {
      await processContactExport(jobId, runtimeEnv);
    }

    await expect(getDataJob(database, workspace.workspaceId, jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 5_001,
      succeeded: 5_001,
      attempts: 1,
      error: null,
    });
  });

  it("throws retryable lease loss when progress CAS expires and then recovers the cursor", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "export-progress-lease");
    const database = createDatabase(env.DB);
    await seedGeneratedContacts(workspace.workspaceId, "progress", 1_000);
    const { jobId } = await startContactExport(database, env.JOBS_QUEUE, workspace);
    const expiringBucket = new Proxy(env.ASSETS_BUCKET, {
      get(target, property, receiver) {
        if (property === "put") {
          return async () => {
            await expireExportLease(jobId);
            return null;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(
      processContactExport(jobId, runtimeWithAssetsBucket(expiringBucket)),
    ).rejects.toThrow("Contact export lease lost while recording progress");

    await processContactExport(jobId, runtimeEnv);
    await processContactExport(jobId, runtimeEnv);
    await expect(getDataJob(database, workspace.workspaceId, jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1_000,
      attempts: 1,
    });
  });

  it("throws retryable lease loss when completion CAS expires and then recovers", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "export-complete-lease");
    const database = createDatabase(env.DB);
    await seedGeneratedContacts(workspace.workspaceId, "complete", 1);
    const { jobId } = await startContactExport(database, env.JOBS_QUEUE, workspace);
    const expiringBucket = new Proxy(env.ASSETS_BUCKET, {
      get(target, property, receiver) {
        if (property === "put") {
          return async (
            key: string,
            value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
            options?: R2PutOptions,
          ) => {
            const result = await target.put(key, value, options);
            if (!key.includes(".parts/")) await expireExportLease(jobId);
            return result;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      processContactExport(jobId, runtimeWithAssetsBucket(expiringBucket)),
    ).rejects.toThrow("Contact export lease lost while completing");

    await processContactExport(jobId, runtimeEnv);
    await expect(getDataJob(database, workspace.workspaceId, jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      attempts: 2,
    });
  });

  it("turns a lost terminal-failure CAS into retryable lease loss before recovery", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "export-failure-lease");
    const database = createDatabase(env.DB);
    const { jobId } = await startContactExport(database, env.JOBS_QUEUE, workspace);
    await env.DB.prepare("UPDATE import_jobs SET cursor = ? WHERE id = ?")
      .bind(JSON.stringify({ partNumber: 1, lastId: "already-exported", filter: {} }), jobId)
      .run();
    const expiringBucket = new Proxy(env.ASSETS_BUCKET, {
      get(target, property, receiver) {
        if (property === "get") {
          return async () => {
            await expireExportLease(jobId);
            return null;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const firstError = await processContactExport(
      jobId,
      runtimeWithAssetsBucket(expiringBucket),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(firstError).toBeInstanceOf(Error);
    expect(firstError).not.toBeInstanceOf(PermanentChannelError);
    expect(firstError).toMatchObject({
      message: "Contact export lease lost while recording terminal failure",
    });

    await expect(processContactExport(jobId, runtimeEnv)).rejects.toThrow(
      "Export part 0 is missing",
    );
    await expect(getDataJob(database, workspace.workspaceId, jobId)).resolves.toMatchObject({
      status: "failed",
      attempts: 2,
      error: "Export part 0 is missing",
    });
  });

  it("reports lease loss when returning a transient failure to pending loses its CAS", async () => {
    const workspace = await seedWorkspaceContext(env.DB, "export-pending-lease");
    const database = createDatabase(env.DB);
    await seedGeneratedContacts(workspace.workspaceId, "pending", 1);
    const { jobId } = await startContactExport(database, env.JOBS_QUEUE, workspace);
    const expiringBucket = new Proxy(env.ASSETS_BUCKET, {
      get(target, property, receiver) {
        if (property === "put") {
          return async () => {
            await expireExportLease(jobId);
            throw new Error("R2 unavailable");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(
      processContactExport(jobId, runtimeWithAssetsBucket(expiringBucket)),
    ).rejects.toThrow("Contact export lease lost while returning to pending");

    await processContactExport(jobId, runtimeEnv);
    await expect(getDataJob(database, workspace.workspaceId, jobId)).resolves.toMatchObject({
      status: "completed",
      processed: 1,
      attempts: 2,
    });
  });
});

async function seedGeneratedContacts(
  workspaceId: string,
  prefix: string,
  count: number,
): Promise<void> {
  await env.DB.prepare(
    `WITH digits(value) AS (
       VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9)
     ),
     numbers(value) AS (
       SELECT ones.value + tens.value * 10 + hundreds.value * 100 + thousands.value * 1000
       FROM digits AS ones
       CROSS JOIN digits AS tens
       CROSS JOIN digits AS hundreds
       CROSS JOIN digits AS thousands
     )
     INSERT INTO contacts
       (id, workspace_id, email, stage, score, status, custom_fields, created_at, updated_at)
     SELECT
       printf('%s-%04d', ?, numbers.value),
       ?,
       printf('%s-%04d@example.com', ?, numbers.value),
       'lead',
       0,
       'active',
       '{}',
       '2026-08-23T00:00:00.000Z',
       '2026-08-23T00:00:00.000Z'
     FROM numbers
     WHERE numbers.value < ?`,
  )
    .bind(prefix, workspaceId, prefix, count)
    .run();
}

async function expireExportLease(jobId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE import_jobs SET cursor = json_set(cursor, '$.leaseExpiresAt', ?) WHERE id = ?",
  )
    .bind("2020-01-01T00:00:00.000Z", jobId)
    .run();
}

function runtimeWithAssetsBucket(bucket: R2Bucket): RuntimeEnv {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "ASSETS_BUCKET") return bucket;
      return Reflect.get(target, property, receiver);
    },
  }) as RuntimeEnv;
}
