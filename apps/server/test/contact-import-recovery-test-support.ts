import { env } from "cloudflare:workers";

import { createDatabase, DataJobRepository, uuidv7 } from "@openengage/database/testing";

import type { RuntimeEnv } from "../src/env";
import { seedWorkspace } from "./factory";

export async function seedImport(rows: Array<Record<string, string>>, totalParts = 1) {
  const { workspaceId } = await seedWorkspace(env.DB);
  const jobId = uuidv7();
  const r2Key = `${workspaceId}/imports/${jobId}`;
  await env.ASSETS_BUCKET.put(
    `${r2Key}/part-0.ndjson`,
    rows.map((row) => JSON.stringify(row)).join("\n"),
  );
  await new DataJobRepository(createDatabase(env.DB), { workspaceId }).createJob({
    id: jobId,
    kind: "contact_import",
    r2Key,
    cursor: { totalParts },
  });
  return { workspaceId, jobId };
}

export function queueStub(
  published: unknown[],
  beforePublish: () => Promise<void> = async () => {},
): Queue {
  return {
    send: async (body: unknown) => {
      published.push(body);
    },
    sendBatch: async (messages: Iterable<MessageSendRequest<unknown>>) => {
      await beforePublish();
      published.push(...[...messages].map((message) => message.body));
    },
  } as unknown as Queue;
}

export function runtimeWithJobsQueue(queue: Queue, database: D1Database = env.DB): RuntimeEnv {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "JOBS_QUEUE") return queue;
      if (property === "DB") return database;
      return Reflect.get(target, property, receiver);
    },
  }) as RuntimeEnv;
}

export function pauseNextDatabaseBatch(source: D1Database): {
  database: D1Database;
  reached: Promise<void>;
  resume: () => void;
} {
  let markReached!: () => void;
  let resume!: () => void;
  let paused = false;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const database = new Proxy(source, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (!paused) {
            paused = true;
            markReached();
            await resumed;
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database, reached, resume };
}

export function failNextDatabaseBatch(source: D1Database, error: Error): D1Database {
  let failed = false;
  return new Proxy(source, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (!failed) {
            failed = true;
            throw error;
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function expirePartLease(jobId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE contact_import_parts SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE job_id = ? AND part = 0",
  )
    .bind(jobId)
    .run();
}

export async function countContacts(workspaceId: string, email: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ? AND email = ?",
  )
    .bind(workspaceId, email)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function readJob(jobId: string) {
  return env.DB.prepare(
    `SELECT status, processed, succeeded, failed
     FROM import_jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first<{ status: string; processed: number; succeeded: number; failed: number }>();
}

export async function readPart(jobId: string, part: number) {
  return env.DB.prepare(
    `SELECT status, attempts, last_error AS lastError
     FROM contact_import_parts WHERE job_id = ? AND part = ?`,
  )
    .bind(jobId, part)
    .first<{ status: string; attempts: number; lastError: string | null }>();
}
