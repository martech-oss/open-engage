import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import {
  programMemberImportRowSchema,
  type ProgramMemberImportRow,
} from "@openengage/core/projects";

import { user } from "../auth/schema";
import { auditLogs } from "../platform/schema";
import { nowIso } from "../shared/database-utils";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import {
  programMemberImports as jobs,
  programMemberImportRows as rows,
} from "./program-import-schema";
import { ProgramError, ProjectProgramRepository } from "./program-repository";
export type ProgramImportJob = typeof jobs.$inferSelect;
export class ProgramMemberImportRepository extends WorkspaceRepository {
  async findRequest(projectId: string, requestKey: string) {
    await new ProjectProgramRepository(this.database, this.context).project(projectId);
    return this.database.orm
      .select()
      .from(jobs)
      .where(
        and(this.inWorkspace(jobs), eq(jobs.projectId, projectId), eq(jobs.requestKey, requestKey)),
      )
      .get();
  }

  async accept(input: {
    projectId: string;
    requestKey: string;
    fingerprint: string;
    csv: string;
    actorUserId: string;
    total: number;
  }) {
    await new ProjectProgramRepository(this.database, this.context).project(input.projectId);
    const now = nowIso();
    await this.database.orm
      .insert(jobs)
      .values({
        ...input,
        id: uuidv7(),
        workspaceId: this.context.workspaceId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const job = await this.database.orm
      .select()
      .from(jobs)
      .where(
        and(
          this.inWorkspace(jobs),
          eq(jobs.projectId, input.projectId),
          eq(jobs.requestKey, input.requestKey),
        ),
      )
      .get();
    if (!job || job.fingerprint !== input.fingerprint || job.csv !== input.csv)
      throw new ProgramError("conflict", "Request key was used with different CSV input");
    return job;
  }
  async get(jobId: string) {
    const job = await this.database.orm
      .select()
      .from(jobs)
      .where(and(this.inWorkspace(jobs), eq(jobs.id, jobId)))
      .get();
    if (!job) throw new ProgramError("not_found", "Import job not found");
    return job;
  }
  async detail(projectId: string, jobId: string) {
    await new ProjectProgramRepository(this.database, this.context).project(projectId);
    const job = await this.get(jobId);
    if (job.projectId !== projectId) throw new ProgramError("not_found", "Import job not found");
    const results = await this.database.orm
      .select()
      .from(rows)
      .where(eq(rows.jobId, jobId))
      .orderBy(asc(rows.row));
    return {
      jobId,
      status: job.status as "pending" | "running" | "completed",
      total: job.total,
      processed: job.processed,
      rows: results.map((r) => programMemberImportRowSchema.parse(JSON.parse(r.result))),
    };
  }
  async claim(jobId: string, now = nowIso()) {
    return this.database.orm
      .update(jobs)
      .set({
        status: "running",
        leaseId: uuidv7(),
        leaseUntil: new Date(Date.parse(now) + 60000).toISOString(),
        updatedAt: now,
      })
      .where(
        and(
          this.inWorkspace(jobs),
          eq(jobs.id, jobId),
          or(
            eq(jobs.status, "pending"),
            and(eq(jobs.status, "running"), lte(jobs.leaseUntil, now)),
          ),
        ),
      )
      .returning()
      .get();
  }
  async commitRow(
    job: ProgramImportJob,
    result: ProgramMemberImportRow,
    statements: BatchItem<"sqlite">[],
  ) {
    const now = nowIso();
    const guard = and(
      this.inWorkspace(jobs),
      eq(jobs.id, job.id),
      eq(jobs.status, "running"),
      eq(jobs.leaseId, job.leaseId!),
      eq(jobs.processed, job.processed),
      sql`${jobs.leaseUntil}>${now}`,
    );
    // The NOT NULL ledger assertion fences the entire D1 transaction, including member CAS/events.
    await this.database.orm.batch([
      this.database.orm.insert(rows).values({
        jobId: job.id,
        row: result.row,
        result: sql`CASE WHEN EXISTS(SELECT 1 FROM ${jobs} WHERE ${guard}) THEN ${JSON.stringify(result)} ELSE NULL END`,
      }),
      ...statements,
      this.database.orm
        .update(jobs)
        .set({
          processed: job.processed + 1,
          leaseUntil: new Date(Date.parse(now) + 60000).toISOString(),
          updatedAt: now,
        })
        .where(guard),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    job.processed++;
  }
  async release(job: ProgramImportJob) {
    const now = nowIso();
    const guard = and(
      this.inWorkspace(jobs),
      eq(jobs.id, job.id),
      eq(jobs.leaseId, job.leaseId!),
      eq(jobs.status, "running"),
    );
    const statements: BatchItem<"sqlite">[] = [];
    if (job.processed === job.total) {
      statements.push(
        this.database.orm
          .insert(auditLogs)
          .select(
            this.database.orm
              .select({
                id: sql<string>`${"program-import:" + job.id}`.as("id"),
                workspaceId: jobs.workspaceId,
                actorUserId: sql<
                  string | null
                >`(SELECT ${user.id} FROM ${user} WHERE ${user.id}=${jobs.actorUserId})`.as(
                  "actor_user_id",
                ),
                apiKeyId: sql<null>`NULL`.as("api_key_id"),
                action: sql<string>`'project.members.import'`.as("action"),
                resourceType: sql<string>`'project'`.as("resource_type"),
                resourceId: jobs.projectId,
                metadata:
                  sql<string>`json_object('jobId',${job.id},'succeeded',(SELECT count(*) FROM ${rows} WHERE ${rows.jobId}=${job.id} AND json_extract(${rows.result},'$.ok')=1),'failed',(SELECT count(*) FROM ${rows} WHERE ${rows.jobId}=${job.id} AND json_extract(${rows.result},'$.ok')=0))`.as(
                    "metadata",
                  ),
                ipAddress: sql<null>`NULL`.as("ip_address"),
                createdAt: sql<string>`${now}`.as("created_at"),
              })
              .from(jobs)
              .where(guard),
          )
          .onConflictDoNothing(),
      );
    }
    statements.push(
      this.database.orm
        .update(jobs)
        .set({
          status: job.processed === job.total ? "completed" : "pending",
          leaseId: null,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(guard),
    );
    await this.database.orm.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
}
export class ProgramMemberImportRecoveryRepository extends DatabaseRepository {
  async recoverable(now = nowIso()) {
    return this.database.orm
      .select({ jobId: jobs.id, workspaceId: jobs.workspaceId })
      .from(jobs)
      .where(
        or(eq(jobs.status, "pending"), and(eq(jobs.status, "running"), lte(jobs.leaseUntil, now))),
      )
      .orderBy(asc(jobs.updatedAt))
      .limit(100);
  }
}
