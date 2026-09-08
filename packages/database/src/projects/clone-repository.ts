import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import {
  projectCloneJobSchema,
  projectCloneResourceSchema,
  type ProjectCloneJob,
  type ProjectCloneOptions,
  type ProjectCloneReferenceMap,
} from "@openengage/core/projects";

import { automations, automationVersions } from "../automations/schema";
import { emailTemplates } from "../messaging/schema";
import { segments } from "../segments/schema";
import { nowIso } from "../shared/database-utils";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { dynamicContents, landingExperiments } from "../web/optimization-schema";
import {
  customRedirects,
  forms,
  formVersions,
  landingPages,
  landingPageVersions,
} from "../web/schema";
import { prepareProjectCloneRow } from "./clone-prepare";
import { projectCloneReferenceGuard } from "./clone-reference-repository";
import { projectCloneJobs, projectCloneMappings } from "./clone-schema";
import { ProjectCloneError, type ProjectCloneCapture } from "./clone-types";
import { formProgramBindings } from "./form-program-schema";
import { projectPrograms } from "./program-schema";
import { projectBriefs, projectItems, projects } from "./schema";
import { projectVariables } from "./variable-schema";

export class ProjectCloneRepository extends WorkspaceRepository {
  private jobScope(id: string) {
    return and(this.inWorkspace(projectCloneJobs), eq(projectCloneJobs.id, id));
  }

  public async createPreview(
    capture: ProjectCloneCapture,
    userId: string,
  ): Promise<ProjectCloneJob> {
    let totalBytes = 0;
    for (const snapshot of capture.snapshots) {
      const bytes = new TextEncoder().encode(JSON.stringify(snapshot.row)).byteLength;
      totalBytes += bytes;
      if (bytes > 800_000 || totalBytes > 8_000_000)
        throw new ProjectCloneError(
          "invalid",
          "複製内容が上限を超えています（1設定800KB・全体8MB）",
        );
    }
    const id = uuidv7(),
      now = nowIso(),
      orm = this.database.orm;
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      orm.insert(projectCloneJobs).values({
        id,
        workspaceId: this.context.workspaceId,
        sourceProjectId: capture.sourceProjectId,
        targetProjectId: capture.targetProjectId,
        createdByUserId: userId,
        options: JSON.stringify(capture.options),
        sharedReferences: JSON.stringify(capture.sharedReferences),
        referenceMap: JSON.stringify(capture.referenceMap),
        createdAt: now,
        updatedAt: now,
      }),
    ];
    for (const [ordinal, snapshot] of capture.snapshots.entries())
      statements.push(
        orm.insert(projectCloneMappings).values({
          jobId: id,
          ordinal,
          kind: snapshot.resource.kind,
          sourceId: snapshot.resource.sourceId,
          targetId: snapshot.resource.targetId,
          metadata: JSON.stringify(snapshot.resource),
          sourceRow: JSON.stringify(snapshot.row),
        }),
      );
    await orm.batch(statements);
    return (await this.get(id))!;
  }

  public async get(id: string): Promise<ProjectCloneJob | null> {
    const row = await this.database.orm
      .select()
      .from(projectCloneJobs)
      .where(this.jobScope(id))
      .get();
    if (!row) return null;
    const mappings = await this.database.orm
      .select()
      .from(projectCloneMappings)
      .where(eq(projectCloneMappings.jobId, id))
      .orderBy(asc(projectCloneMappings.ordinal));
    return projectCloneJobSchema.parse({
      ...row,
      options: JSON.parse(row.options),
      sharedReferences: JSON.parse(row.sharedReferences),
      resources: mappings.map((item) => JSON.parse(item.metadata) as unknown),
      preparedCount: mappings.filter((item) => item.targetRow !== null).length,
      totalCount: mappings.length,
    });
  }

  public async list(projectId: string): Promise<ProjectCloneJob[]> {
    const ids = await this.database.orm
      .select({ id: projectCloneJobs.id })
      .from(projectCloneJobs)
      .where(
        and(this.inWorkspace(projectCloneJobs), eq(projectCloneJobs.sourceProjectId, projectId)),
      )
      .orderBy(sql`${projectCloneJobs.createdAt} DESC`)
      .limit(20);
    const jobs: ProjectCloneJob[] = [];
    for (const row of ids) {
      const job = await this.get(row.id);
      if (job) jobs.push(job);
    }
    return jobs;
  }

  public async start(id: string, requestKey: string): Promise<ProjectCloneJob> {
    const existing = await this.database.orm
      .select({ id: projectCloneJobs.id })
      .from(projectCloneJobs)
      .where(and(this.inWorkspace(projectCloneJobs), eq(projectCloneJobs.requestKey, requestKey)))
      .get();
    if (existing && existing.id !== id)
      throw new ProjectCloneError("conflict", "この要求キーは別の複製に使用されています");
    const result = await this.database.orm
      .update(projectCloneJobs)
      .set({ status: "queued", requestKey, updatedAt: nowIso() })
      .where(
        and(
          this.jobScope(id),
          eq(projectCloneJobs.status, "preview"),
          isNull(projectCloneJobs.requestKey),
        ),
      )
      .returning({ id: projectCloneJobs.id })
      .get();
    const job = await this.get(id);
    if (!job) throw new ProjectCloneError("not_found", "複製ジョブが見つかりません");
    if (!result && !existing) {
      const current = await this.database.orm
        .select({ requestKey: projectCloneJobs.requestKey })
        .from(projectCloneJobs)
        .where(this.jobScope(id))
        .get();
      if (current?.requestKey !== requestKey)
        throw new ProjectCloneError("conflict", "複製は別の要求で開始済みです");
    }
    return job;
  }

  public async retry(id: string): Promise<ProjectCloneJob> {
    await this.database.orm
      .update(projectCloneJobs)
      .set({ status: "queued", error: null, leaseId: null, leaseUntil: null, updatedAt: nowIso() })
      .where(and(this.jobScope(id), eq(projectCloneJobs.status, "failed")));
    const job = await this.get(id);
    if (!job) throw new ProjectCloneError("not_found", "複製ジョブが見つかりません");
    return job;
  }

  /** Each invocation stages a bounded chunk. The next queue delivery resumes at the first unstaged row. */
  public async process(id: string, chunkSize = 20): Promise<"continue" | "completed" | "busy"> {
    const orm = this.database.orm,
      now = nowIso(),
      leaseId = uuidv7();
    const row = await orm
      .update(projectCloneJobs)
      .set({
        status: "running",
        leaseId,
        leaseUntil: new Date(Date.now() + 120_000).toISOString(),
        updatedAt: now,
      })
      .where(
        and(
          this.jobScope(id),
          or(
            eq(projectCloneJobs.status, "queued"),
            and(eq(projectCloneJobs.status, "running"), lte(projectCloneJobs.leaseUntil, now)),
          ),
        ),
      )
      .returning()
      .get();
    if (!row) return (await this.get(id))?.status === "completed" ? "completed" : "busy";
    const guard = and(
      this.jobScope(id),
      eq(projectCloneJobs.status, "running"),
      eq(projectCloneJobs.leaseId, leaseId),
    );
    try {
      const options = JSON.parse(row.options) as ProjectCloneOptions;
      const referenceMap = JSON.parse(row.referenceMap) as ProjectCloneReferenceMap;
      const pending = await orm
        .select()
        .from(projectCloneMappings)
        .where(and(eq(projectCloneMappings.jobId, id), isNull(projectCloneMappings.targetRow)))
        .orderBy(asc(projectCloneMappings.ordinal))
        .limit(Math.max(1, Math.min(chunkSize, 30)));
      for (const item of pending) {
        const resource = projectCloneResourceSchema.parse(JSON.parse(item.metadata));
        const target = prepareProjectCloneRow(
          resource,
          JSON.parse(item.sourceRow) as Record<string, unknown>,
          referenceMap,
          options,
          row.createdAt,
        );
        await orm
          .update(projectCloneMappings)
          .set({ targetRow: JSON.stringify(target) })
          .where(
            and(
              eq(projectCloneMappings.jobId, id),
              eq(projectCloneMappings.ordinal, item.ordinal),
              isNull(projectCloneMappings.targetRow),
              sql`EXISTS (SELECT 1 FROM ${projectCloneJobs} WHERE ${projectCloneJobs.id} = ${id} AND ${projectCloneJobs.leaseId} = ${leaseId} AND ${projectCloneJobs.status} = 'running')`,
            ),
          );
      }
      const remaining = await orm
        .select({ ordinal: projectCloneMappings.ordinal })
        .from(projectCloneMappings)
        .where(and(eq(projectCloneMappings.jobId, id), isNull(projectCloneMappings.targetRow)))
        .limit(1);
      if (remaining.length) {
        await orm
          .update(projectCloneJobs)
          .set({ status: "queued", leaseId: null, leaseUntil: null, updatedAt: nowIso() })
          .where(guard);
        return "continue";
      }
      await this.materialize(id, leaseId);
      return "completed";
    } catch (error) {
      await orm
        .update(projectCloneJobs)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 2000) : "複製に失敗しました",
          leaseId: null,
          leaseUntil: null,
          updatedAt: nowIso(),
        })
        .where(guard);
      throw error;
    }
  }

  private async materialize(id: string, leaseId: string): Promise<void> {
    const orm = this.database.orm;
    const job = await orm.select().from(projectCloneJobs).where(this.jobScope(id)).get();
    if (!job) throw new ProjectCloneError("not_found", "複製ジョブが見つかりません");
    const mappings = await orm
      .select()
      .from(projectCloneMappings)
      .where(eq(projectCloneMappings.jobId, id))
      .orderBy(asc(projectCloneMappings.ordinal));
    const sharedReferences = JSON.parse(
      job.sharedReferences,
    ) as ProjectCloneJob["sharedReferences"];
    // A failed check violates the status constraint and rolls back the entire D1 batch.
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      orm
        .update(projectCloneJobs)
        .set({
          status: sql`CASE WHEN ${projectCloneJobs.status} = 'running' AND ${projectCloneJobs.leaseId} = ${leaseId} THEN 'running' ELSE 'invalid' END`,
        })
        .where(this.jobScope(id)),
    ];
    // D1 permits 100 bound parameters per statement, including statements within a batch.
    for (let offset = 0; offset < sharedReferences.length; offset += 20) {
      const guards = sharedReferences
        .slice(offset, offset + 20)
        .map((ref) => projectCloneReferenceGuard(this.context.workspaceId, ref));
      statements.push(
        orm
          .update(projectCloneJobs)
          .set({
            status: sql`CASE WHEN ${sql.join(guards, sql` AND `)} THEN 'running' ELSE 'invalid' END`,
          })
          .where(this.jobScope(id)),
      );
    }
    const priorities: Record<string, number> = {
      project: 0,
      brief: 1,
      variable: 1,
      program: 1,
      form: 2,
      landing_page: 2,
      automation: 2,
      segment: 2,
      email_sequence: 2,
      redirect: 2,
      form_version: 3,
      form_binding: 3,
      landing_page_version: 4,
      automation_version: 4,
      experiment: 5,
      dynamic_content: 5,
    };
    mappings.sort((a, b) => (priorities[a.kind] ?? 9) - (priorities[b.kind] ?? 9));
    const briefWrites: BatchItem<"sqlite">[] = [];
    for (const mapping of mappings) {
      if (!mapping.targetRow)
        throw new ProjectCloneError("invalid", "複製の準備が完了していません");
      const row = JSON.parse(mapping.targetRow) as Record<string, unknown>;
      if (row.workspaceId !== this.context.workspaceId)
        throw new ProjectCloneError("invalid", "複製のWorkspaceが一致しません");
      // Source rows come exclusively from the fixed, server-created manifest. The whitelist prevents arbitrary table writes.
      switch (mapping.kind) {
        case "project":
          statements.push(orm.insert(projects).values(row as typeof projects.$inferInsert));
          break;
        case "brief":
          briefWrites.push(
            orm.insert(projectBriefs).values(row as typeof projectBriefs.$inferInsert),
          );
          break;
        case "variable":
          statements.push(
            orm.insert(projectVariables).values(row as typeof projectVariables.$inferInsert),
          );
          break;
        case "program":
          statements.push(
            orm.insert(projectPrograms).values(row as typeof projectPrograms.$inferInsert),
          );
          break;
        case "automation":
          statements.push(orm.insert(automations).values(row as typeof automations.$inferInsert));
          break;
        case "automation_version":
          statements.push(
            orm.insert(automationVersions).values(row as typeof automationVersions.$inferInsert),
          );
          break;
        case "form":
          statements.push(orm.insert(forms).values(row as typeof forms.$inferInsert));
          break;
        case "form_version":
          statements.push(orm.insert(formVersions).values(row as typeof formVersions.$inferInsert));
          break;
        case "form_binding":
          statements.push(
            orm.insert(formProgramBindings).values(row as typeof formProgramBindings.$inferInsert),
          );
          break;
        case "landing_page":
          statements.push(orm.insert(landingPages).values(row as typeof landingPages.$inferInsert));
          break;
        case "landing_page_version":
          statements.push(
            orm.insert(landingPageVersions).values(row as typeof landingPageVersions.$inferInsert),
          );
          break;
        case "experiment":
          statements.push(
            orm.insert(landingExperiments).values(row as typeof landingExperiments.$inferInsert),
          );
          break;
        case "dynamic_content":
          statements.push(
            orm.insert(dynamicContents).values(row as typeof dynamicContents.$inferInsert),
          );
          break;
        case "segment":
          statements.push(orm.insert(segments).values(row as typeof segments.$inferInsert));
          break;
        case "redirect":
          statements.push(
            orm.insert(customRedirects).values(row as typeof customRedirects.$inferInsert),
          );
          break;
        case "email_sequence":
          statements.push(
            orm.insert(emailTemplates).values(row as typeof emailTemplates.$inferInsert),
          );
          break;
        default:
          throw new ProjectCloneError("invalid", `未対応の複製設定です: ${mapping.kind}`);
      }
    }
    for (const mapping of mappings) {
      const metadata = projectCloneResourceSchema.parse(JSON.parse(mapping.metadata));
      if (metadata.linked)
        statements.push(
          orm.insert(projectItems).values({
            workspaceId: this.context.workspaceId,
            projectId: job.targetProjectId,
            resourceType: metadata.kind,
            resourceId: metadata.targetId,
            briefRevision: null,
            addedByUserId: job.createdByUserId,
            createdAt: nowIso(),
          }),
        );
    }
    // Create the initial links before the draft brief. The approved-revision link
    // trigger still protects subsequent edits; this entire setup commits atomically.
    statements.push(...briefWrites);
    statements.push(
      orm
        .update(projectCloneJobs)
        .set({
          status: "completed",
          completedAt: nowIso(),
          updatedAt: nowIso(),
          leaseId: null,
          leaseUntil: null,
          error: null,
        })
        .where(this.jobScope(id)),
    );
    await orm.batch(statements);
  }
}

export class ProjectCloneRecoveryRepository extends DatabaseRepository {
  public async due(now: string) {
    return this.database.orm
      .select({ id: projectCloneJobs.id, workspaceId: projectCloneJobs.workspaceId })
      .from(projectCloneJobs)
      .where(
        or(
          eq(projectCloneJobs.status, "queued"),
          and(eq(projectCloneJobs.status, "running"), lte(projectCloneJobs.leaseUntil, now)),
        ),
      )
      .orderBy(asc(projectCloneJobs.updatedAt))
      .limit(50);
  }
}
