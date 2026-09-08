import { and, asc, desc, eq, exists, isNull, notExists, or, sql } from "drizzle-orm";

import {
  projectProgramDefinitionSchema,
  projectProgramSchema,
  type ProjectProgramDefinition,
  type ProjectProgram,
} from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { projectPrograms, projectProgramVersions } from "./program-schema";
import { projectBriefs, projects } from "./schema";

export class ProgramError extends Error {
  constructor(
    public readonly code: "not_found" | "conflict" | "invalid" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "ProgramError";
  }
}
export class ProjectProgramRepository extends WorkspaceRepository {
  public async project(projectId: string) {
    const row = await this.database.orm
      .select()
      .from(projects)
      .where(
        and(this.inWorkspace(projects), eq(projects.id, projectId), isNull(projects.archivedAt)),
      )
      .get();
    if (!row) throw new ProgramError("not_found", "Project not found");
    return row;
  }
  public async get(projectId: string): Promise<ProjectProgram | null> {
    await this.project(projectId);
    const row = await this.database.orm
      .select()
      .from(projectPrograms)
      .where(and(this.inWorkspace(projectPrograms), eq(projectPrograms.projectId, projectId)))
      .get();
    if (!row) return null;
    const versions = await this.database.orm
      .select()
      .from(projectProgramVersions)
      .where(
        and(
          this.inWorkspace(projectProgramVersions),
          eq(projectProgramVersions.projectId, projectId),
        ),
      )
      .orderBy(desc(projectProgramVersions.version));
    return projectProgramSchema.parse({
      ...row,
      definition: JSON.parse(row.definition),
      publishedDefinition: versions.find((v) => v.version === row.publishedVersion)
        ? JSON.parse(versions.find((v) => v.version === row.publishedVersion)!.definition)
        : null,
      versions: versions.map((v) => ({ ...v, definition: JSON.parse(v.definition) })),
    });
  }
  public async definition(projectId: string, version: number) {
    await this.project(projectId);
    const row = await this.database.orm
      .select()
      .from(projectProgramVersions)
      .where(
        and(
          this.inWorkspace(projectProgramVersions),
          eq(projectProgramVersions.projectId, projectId),
          eq(projectProgramVersions.version, version),
        ),
      )
      .get();
    if (!row) throw new ProgramError("not_found", "Published program definition not found");
    return projectProgramDefinitionSchema.parse(JSON.parse(row.definition));
  }
  public async brief(projectId: string) {
    return this.database.orm
      .select()
      .from(projectBriefs)
      .where(and(this.inWorkspace(projectBriefs), eq(projectBriefs.projectId, projectId)))
      .get();
  }
  private writable(projectId: string, workspace: WorkspaceContext, publishing: boolean) {
    const brief = this.database.orm
      .select({ id: projectBriefs.projectId })
      .from(projectBriefs)
      .where(and(this.inWorkspace(projectBriefs), eq(projectBriefs.projectId, projectId)));
    const allowedBrief = this.database.orm
      .select({ id: projectBriefs.projectId })
      .from(projectBriefs)
      .where(
        and(
          this.inWorkspace(projectBriefs),
          eq(projectBriefs.projectId, projectId),
          eq(projectBriefs.status, publishing ? "approved" : "draft"),
          workspace.role === "owner" || workspace.role === "admin"
            ? undefined
            : eq(projectBriefs.ownerUserId, workspace.userId),
        ),
      );
    return and(
      exists(
        this.database.orm
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              this.inWorkspace(projects),
              eq(projects.id, projectId),
              isNull(projects.archivedAt),
            ),
          ),
      ),
      or(notExists(brief), exists(allowedBrief)),
    );
  }
  public async save(
    workspace: WorkspaceContext,
    projectId: string,
    input: { definition: ProjectProgramDefinition; expectedRowVersion: number },
  ) {
    await this.project(projectId);
    const definition = JSON.stringify(projectProgramDefinitionSchema.parse(input.definition));
    const now = nowIso();
    const query =
      input.expectedRowVersion === 0
        ? this.database.orm
            .insert(projectPrograms)
            .select(
              sql`SELECT ${this.context.workspaceId},${projectId},${definition},1,NULL,${now} WHERE ${this.writable(projectId, workspace, false)}`,
            )
            .onConflictDoNothing()
        : this.database.orm
            .update(projectPrograms)
            .set({ definition, rowVersion: sql`${projectPrograms.rowVersion}+1`, updatedAt: now })
            .where(
              and(
                this.inWorkspace(projectPrograms),
                eq(projectPrograms.projectId, projectId),
                eq(projectPrograms.rowVersion, input.expectedRowVersion),
                this.writable(projectId, workspace, false),
              ),
            );
    const result = await query;
    if (result.meta.changes !== 1)
      throw new ProgramError(
        "conflict",
        "Definition changed or brief must be reopened to draft before editing",
      );
    return (await this.get(projectId))!;
  }
  public async publish(workspace: WorkspaceContext, projectId: string, expectedRowVersion: number) {
    const current = await this.get(projectId);
    if (!current) throw new ProgramError("not_found", "Program not configured");
    const version = (current.publishedVersion ?? 0) + 1;
    const now = nowIso();
    const predicate = and(
      this.inWorkspace(projectPrograms),
      eq(projectPrograms.projectId, projectId),
      eq(projectPrograms.rowVersion, expectedRowVersion),
      this.writable(projectId, workspace, true),
    );
    const updated = await this.database.orm.batch([
      this.database.orm
        .update(projectPrograms)
        .set({
          publishedVersion: version,
          rowVersion: sql`${projectPrograms.rowVersion}+1`,
          updatedAt: now,
        })
        .where(predicate),
      this.database.orm
        .insert(projectProgramVersions)
        .select(
          sql`SELECT ${this.context.workspaceId},${projectId},${version},${JSON.stringify(current.definition)},${now},${workspace.userId} WHERE changes()=1`,
        ),
    ]);
    if (updated[0].meta.changes !== 1)
      throw new ProgramError(
        "conflict",
        "Definition changed or brief approval is required before publication",
      );
    return (await this.get(projectId))!;
  }
  public async versionOptions(projectId: string) {
    return this.database.orm
      .select()
      .from(projectProgramVersions)
      .where(
        and(
          this.inWorkspace(projectProgramVersions),
          eq(projectProgramVersions.projectId, projectId),
        ),
      )
      .orderBy(asc(projectProgramVersions.version));
  }
}
