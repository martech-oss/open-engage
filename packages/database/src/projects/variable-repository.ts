import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import {
  createVariableSnapshot,
  variableDefinitionSchema,
  variableWriteSchema,
  type VariableDefinition,
  type VariableWrite,
} from "@openengage/core/projects";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { projects } from "./schema";
import { projectVariables } from "./variable-schema";
export class VariableRepositoryError extends Error {
  constructor(
    public readonly kind: "conflict" | "type" | "project",
    message: string,
  ) {
    super(message);
    this.name = "VariableRepositoryError";
  }
}
const decode = (row: typeof projectVariables.$inferSelect): VariableDefinition =>
  variableDefinitionSchema.parse({ ...row, value: JSON.parse(row.value) });
export class VariableRepository extends WorkspaceRepository {
  async assertProject(projectId: string | null) {
    if (
      projectId &&
      !(await this.database.orm
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(this.inWorkspace(projects), eq(projects.id, projectId), isNull(projects.archivedAt)),
        )
        .get())
    )
      throw new VariableRepositoryError("project", "Variable project not found");
  }
  private scope(projectId: string | null, key?: string) {
    return and(
      this.inWorkspace(projectVariables),
      projectId === null
        ? isNull(projectVariables.projectId)
        : eq(projectVariables.projectId, projectId),
      key === undefined ? undefined : eq(projectVariables.key, key),
    );
  }
  async list(projectId: string | null): Promise<VariableDefinition[]> {
    await this.assertProject(projectId);
    return (
      await this.database.orm
        .select()
        .from(projectVariables)
        .where(
          and(
            this.inWorkspace(projectVariables),
            isNull(projectVariables.deletedAt),
            projectId === null
              ? isNull(projectVariables.projectId)
              : or(isNull(projectVariables.projectId), eq(projectVariables.projectId, projectId)),
          ),
        )
        .orderBy(projectVariables.key)
    ).map(decode);
  }
  /** Export for frozen clone manifests; includes only local overrides, never inherited values. */
  async own(projectId: string | null): Promise<VariableDefinition[]> {
    return (await this.list(projectId)).filter((value) => value.projectId === projectId);
  }
  async resolve(projectId: string | null) {
    return createVariableSnapshot(await this.list(projectId), this.context.workspaceId, projectId);
  }
  async save(raw: VariableWrite): Promise<VariableDefinition> {
    const input = variableWriteSchema.parse(raw);
    await this.assertProject(input.projectId);
    const incompatible = await this.database.orm
      .select({ id: projectVariables.id })
      .from(projectVariables)
      .where(
        and(
          this.inWorkspace(projectVariables),
          isNull(projectVariables.deletedAt),
          eq(projectVariables.key, input.key),
          ne(projectVariables.type, input.type),
        ),
      )
      .get();
    if (incompatible)
      throw new VariableRepositoryError(
        "type",
        "Variable key type cannot change while definitions use it",
      );
    const now = nowIso();
    let row;
    if (input.expectedRevision === 0) {
      // A tombstone keeps the scope/key generation: old editors can never match a replacement.
      // The type guard is evaluated atomically for both insertion and revival.
      const typeGuard = sql`CASE WHEN NOT EXISTS(SELECT 1 FROM project_variables WHERE workspace_id=${this.context.workspaceId} AND key=${input.key} AND type!=${input.type} AND deleted_at IS NULL) THEN ${input.type} ELSE NULL END`;
      row = await this.database.orm
        .insert(projectVariables)
        .values({
          id: uuidv7(),
          workspaceId: this.context.workspaceId,
          projectId: input.projectId,
          key: input.key,
          type: typeGuard,
          value: JSON.stringify(input.value),
          revision: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target:
            input.projectId === null
              ? [projectVariables.workspaceId, projectVariables.key]
              : [projectVariables.workspaceId, projectVariables.projectId, projectVariables.key],
          ...(input.projectId === null ? { targetWhere: isNull(projectVariables.projectId) } : {}),
          set: {
            type: typeGuard,
            value: JSON.stringify(input.value),
            revision: sql`${projectVariables.revision}+1`,
            updatedAt: now,
            deletedAt: null,
          },
          setWhere: isNotNull(projectVariables.deletedAt),
        })
        .returning()
        .get();
    } else {
      row = await this.database.orm
        .update(projectVariables)
        .set({
          value: JSON.stringify(input.value),
          revision: sql`${projectVariables.revision}+1`,
          updatedAt: now,
        })
        .where(
          and(
            this.scope(input.projectId, input.key),
            isNull(projectVariables.deletedAt),
            eq(projectVariables.revision, input.expectedRevision),
            eq(projectVariables.type, input.type),
          ),
        )
        .returning()
        .get();
    }
    if (!row)
      throw new VariableRepositoryError(
        "conflict",
        "Variable revision conflict; reload before saving",
      );
    return decode(row);
  }
  async remove(input: { projectId: string | null; key: string; expectedRevision: number }) {
    await this.assertProject(input.projectId);
    const row = await this.database.orm
      .update(projectVariables)
      .set({
        deletedAt: nowIso(),
        updatedAt: nowIso(),
        revision: sql`${projectVariables.revision}+1`,
      })
      .where(
        and(
          this.scope(input.projectId, input.key),
          isNull(projectVariables.deletedAt),
          eq(projectVariables.revision, input.expectedRevision),
        ),
      )
      .returning({ id: projectVariables.id })
      .get();
    if (!row)
      throw new VariableRepositoryError(
        "conflict",
        "Variable revision conflict; reload before removing",
      );
  }
}
