import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  projectProgramDefinitionSchema,
  variableValueSchema,
  type ProjectCloneOptions,
  type ProjectCloneResourceKind,
} from "@openengage/core/projects";

import { member } from "../auth/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import {
  ProjectCloneError,
  type ProjectCloneCapture,
  type ProjectCloneSnapshot,
} from "./clone-types";
import { projectPrograms, projectProgramVersions } from "./program-schema";
import { projectBriefs, projectBriefVersions } from "./schema";
import { projectVariables } from "./variable-schema";

export class ProjectCloneSettingsRepository extends WorkspaceRepository {
  public async capture(
    projectId: string,
    targetProjectId: string,
    options: ProjectCloneOptions,
    add: (
      kind: ProjectCloneResourceKind,
      row: Record<string, unknown>,
      linked?: boolean,
      sourceId?: string,
      targetId?: string,
    ) => ProjectCloneSnapshot,
  ): Promise<void> {
    const orm = this.database.orm;
    const program = await orm
      .select()
      .from(projectPrograms)
      .where(and(this.inWorkspace(projectPrograms), eq(projectPrograms.projectId, projectId)))
      .get();
    if (program) {
      const published =
        program.publishedVersion === null
          ? undefined
          : await orm
              .select()
              .from(projectProgramVersions)
              .where(
                and(
                  this.inWorkspace(projectProgramVersions),
                  eq(projectProgramVersions.projectId, projectId),
                  eq(projectProgramVersions.version, program.publishedVersion),
                ),
              )
              .get();
      add(
        "program",
        { ...program, definition: published?.definition ?? program.definition },
        false,
        projectId,
        targetProjectId,
      );
    }
    const variableRows = await orm
      .select()
      .from(projectVariables)
      .where(and(this.inWorkspace(projectVariables), isNull(projectVariables.deletedAt)));
    const localVariables = variableRows.filter((row) => row.projectId === projectId);
    for (const variable of localVariables) add("variable", variable);
    for (const [key, value] of Object.entries(options.variables)) {
      const definition =
        localVariables.find((row) => row.key === key) ??
        variableRows.find((row) => row.projectId === null && row.key === key);
      if (!definition || !variableValueSchema.safeParse({ type: definition.type, value }).success)
        throw new ProjectCloneError("invalid", `変数の型または値が不正です: ${key}`);
      if (definition.projectId === null)
        add("variable", { ...definition, projectId }, false, `override:${definition.id}`);
    }
    const brief = await orm
      .select()
      .from(projectBriefs)
      .where(and(this.inWorkspace(projectBriefs), eq(projectBriefs.projectId, projectId)))
      .get();
    if (brief) {
      if (!options.ownerUserId || !options.approverUserId || !options.reviewAt)
        throw new ProjectCloneError(
          "invalid",
          "ブリーフの複製には担当者・承認者・レビュー日が必要です",
        );
      const assigned = await orm
        .select({ id: member.userId })
        .from(member)
        .where(
          and(
            eq(member.organizationId, this.context.workspaceId),
            inArray(member.userId, [options.ownerUserId, options.approverUserId]),
            inArray(member.role, ["owner", "admin", "marketer"]),
          ),
        );
      if (new Set(assigned.map((item) => item.id)).size !== 2)
        throw new ProjectCloneError(
          "invalid",
          "担当者・承認者にはWorkspaceの編集可能なメンバーを指定してください",
        );
      const published = await orm
        .select()
        .from(projectBriefVersions)
        .where(
          and(
            this.inWorkspace(projectBriefVersions),
            eq(projectBriefVersions.projectId, projectId),
          ),
        )
        .orderBy(desc(projectBriefVersions.revision))
        .get();
      add(
        "brief",
        {
          ...brief,
          ...(published
            ? { definition: published.definition, primaryMotion: published.primaryMotion }
            : {}),
        },
        false,
        projectId,
        targetProjectId,
      );
    }
  }
}

export function validateCloneProgramBindings(capture: ProjectCloneCapture): void {
  const projectId = capture.sourceProjectId;
  const snapshots = new Map(
    capture.snapshots.map((snapshot) => [
      `${snapshot.resource.kind}:${snapshot.resource.sourceId}`,
      snapshot,
    ]),
  );
  const selectedProgram = snapshots.get(`program:${projectId}`);
  const selectedDefinition = selectedProgram
    ? projectProgramDefinitionSchema.parse(JSON.parse(String(selectedProgram.row.definition)))
    : null;
  const validateQualified = (value: unknown, name: string): void => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const program = node.program as
      | { projectId?: unknown; definitionVersion?: unknown }
      | undefined;
    if (
      node.kind === "condition" &&
      node.field === "project_status" &&
      program?.projectId === projectId
    ) {
      const statuses = Array.isArray(node.value) ? node.value : [node.value];
      if (
        program.definitionVersion !== selectedProgram?.row.publishedVersion ||
        !statuses.every((id) => selectedDefinition?.statuses.some((status) => status.id === id))
      )
        throw new ProjectCloneError(
          "conflict",
          `${name}: 参加ステータス条件のプログラム版が複製する公開定義と一致しません。条件の版を確認して再度プレビューしてください`,
        );
    }
    for (const child of Object.values(value)) validateQualified(child, name);
  };
  for (const snapshot of capture.snapshots) {
    for (const key of ["graph", "filterAst"]) {
      const raw = snapshot.row[key];
      if (typeof raw === "string") validateQualified(JSON.parse(raw), snapshot.resource.name);
    }
    if (snapshot.resource.kind !== "form_binding" || snapshot.row.projectId !== projectId) continue;
    if (!selectedDefinition?.statuses.some((status) => status.id === snapshot.row.statusId)) {
      const form = snapshots.get(`form:${String(snapshot.row.formId)}`);
      throw new ProjectCloneError(
        "conflict",
        `${form?.resource.name ?? "フォーム"}: ステータス ${String(snapshot.row.statusId)} が複製するプログラム定義にありません。プログラムまたはフォームの公開版を揃えて再度プレビューしてください`,
      );
    }
  }
}
