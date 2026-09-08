import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";

import {
  type ProjectCloneOptions,
  type ProjectCloneResourceKind,
  type ProjectResourceType,
} from "@openengage/core/projects";

import { organization } from "../auth/schema";
import { automations, automationVersions } from "../automations/schema";
import { emailTemplates } from "../messaging/schema";
import { segments } from "../segments/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { dynamicContents, landingExperiments } from "../web/optimization-schema";
import {
  customRedirects,
  forms,
  formVersions,
  landingPages,
  landingPageVersions,
} from "../web/schema";
import {
  ProjectCloneSettingsRepository,
  validateCloneProgramBindings,
} from "./clone-settings-repository";
import {
  ProjectCloneError,
  type ProjectCloneCapture,
  type ProjectCloneSnapshot,
} from "./clone-types";
import { formProgramBindings } from "./form-program-schema";
import { projectItems, projects } from "./schema";

/** Captures immutable source payloads; the worker never rereads mutable source content. */
export class ProjectCloneSnapshotRepository extends WorkspaceRepository {
  public async capture(
    projectId: string,
    options: ProjectCloneOptions,
    publicOrigin: string,
  ): Promise<ProjectCloneCapture> {
    const orm = this.database.orm;
    const project = await orm
      .select()
      .from(projects)
      .where(
        and(this.inWorkspace(projects), eq(projects.id, projectId), isNull(projects.archivedAt)),
      )
      .get();
    if (!project) throw new ProjectCloneError("not_found", "複製元の施策が見つかりません");
    const workspace = await orm
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, this.context.workspaceId))
      .get();
    if (!workspace) throw new ProjectCloneError("not_found", "Workspaceが見つかりません");
    const snapshots = new Map<string, ProjectCloneSnapshot>();
    const targetProjectId = uuidv7();
    const result: ProjectCloneCapture = {
      sourceProjectId: projectId,
      targetProjectId,
      options,
      snapshots: [],
      sharedReferences: [],
      referenceMap: { ids: { [projectId]: targetProjectId }, segmentSlugs: {}, managedUrls: {} },
    };
    const add = (
      kind: ProjectCloneResourceKind,
      row: Record<string, unknown>,
      linked = false,
      sourceId = String(row.id ?? row.projectId),
      targetId = uuidv7(),
    ) => {
      const key = `${kind}:${sourceId}`;
      const existing = snapshots.get(key);
      if (existing) {
        existing.resource.linked ||= linked;
        return existing;
      }
      if (snapshots.size >= 150)
        throw new ProjectCloneError("invalid", "一度に複製できる設定・リソースは150件までです");
      const sourceSlug = typeof row.slug === "string" ? row.slug : null;
      const targetSlug = sourceSlug
        ? `${sourceSlug.slice(0, 47).replace(/-+$/, "")}-${targetId.replaceAll("-", "")}`
        : null;
      const snapshot: ProjectCloneSnapshot = {
        resource: {
          kind,
          sourceId,
          targetId,
          name:
            typeof row.name === "string" ? row.name : typeof row.key === "string" ? row.key : kind,
          sourceVersion:
            typeof row.version === "number" || typeof row.version === "string"
              ? String(row.version)
              : typeof row.publishedVersionId === "string"
                ? row.publishedVersionId
                : null,
          sourceSlug,
          targetSlug,
          linked,
        },
        row,
      };
      snapshots.set(key, snapshot);
      // Compound/Project-keyed configuration rows must not overwrite the Project's ID mapping.
      if (!["brief", "program", "form_binding", "dynamic_content"].includes(kind))
        result.referenceMap.ids[sourceId] = targetId;
      if (sourceSlug && targetSlug) {
        if (kind === "segment") result.referenceMap.segmentSlugs[sourceSlug] = targetSlug;
        const prefix =
          kind === "landing_page" ? "p" : kind === "form" ? "f" : kind === "redirect" ? "r" : null;
        if (prefix)
          result.referenceMap.managedUrls[
            `${publicOrigin}/${prefix}/${workspace.slug}/${sourceSlug}`
          ] = `${publicOrigin}/${prefix}/${workspace.slug}/${targetSlug}`;
      }
      return snapshot;
    };
    add("project", project, false, projectId, targetProjectId);
    await new ProjectCloneSettingsRepository(this.database, this.context).capture(
      projectId,
      targetProjectId,
      options,
      add,
    );
    const links = await orm
      .select()
      .from(projectItems)
      .where(and(this.inWorkspace(projectItems), eq(projectItems.projectId, projectId)));
    const requireRow = <T>(row: T | undefined, kind: string, id: string): T => {
      if (!row) throw new ProjectCloneError("invalid", `参照先が見つかりません: ${kind} ${id}`);
      return row;
    };
    const captureFormVersion = async (id: string) => {
      if (snapshots.has(`form_version:${id}`)) return;
      const row = requireRow(
        await orm
          .select()
          .from(formVersions)
          .where(and(this.inWorkspace(formVersions), eq(formVersions.id, id)))
          .get(),
        "form_version",
        id,
      );
      await captureResource("form", row.formId, false, row);
      add("form_version", row);
    };
    const capturePageVersion = async (id: string, pageId: string) => {
      if (snapshots.has(`landing_page_version:${id}`)) return;
      const row = requireRow(
        await orm
          .select()
          .from(landingPageVersions)
          .where(
            and(
              this.inWorkspace(landingPageVersions),
              eq(landingPageVersions.id, id),
              eq(landingPageVersions.pageId, pageId),
            ),
          )
          .get(),
        "landing_page_version",
        id,
      );
      const document = row.document
        ? (JSON.parse(row.document) as { forms?: Array<{ refId: string; formId?: string }> })
        : null;
      const bindings = JSON.parse(row.formBindings) as Array<{
        refId: string;
        formId: string;
        formVersionId: string;
      }>;
      // Published pages own immutable form snapshots. Use those as the cloned
      // draft's form sources, including their frozen program and variable context.
      if (row.publishedAt) {
        for (const form of document?.forms ?? []) {
          const binding = bindings.find((item) => item.refId === form.refId);
          if (!binding)
            throw new ProjectCloneError("invalid", "公開LPのフォーム版が見つかりません");
          await captureFormVersion(binding.formVersionId);
          const captured = snapshots.get(`form_version:${binding.formVersionId}`);
          if (captured?.row.formId !== binding.formId)
            throw new ProjectCloneError("invalid", "公開LPのフォーム参照が一致しません");
          form.formId = binding.formId;
        }
      }
      add("landing_page_version", {
        ...row,
        document: document ? JSON.stringify(document) : row.document,
      });
      for (const form of document?.forms ?? [])
        if (form.formId) await captureResource("form", form.formId);
      for (const binding of bindings) await captureFormVersion(binding.formVersionId);
    };
    const captureResource = async (
      kind: ProjectResourceType,
      id: string,
      linked = false,
      pinnedFormVersion?: typeof formVersions.$inferSelect,
    ): Promise<void> => {
      const existing = snapshots.get(`${kind}:${id}`);
      if (existing) {
        if (pinnedFormVersion && existing.row.version !== pinnedFormVersion.version)
          throw new ProjectCloneError(
            "conflict",
            "同じフォームの異なる公開版が必要です。LPのフォーム参照を更新して再度プレビューしてください",
          );
        existing.resource.linked ||= linked;
        return;
      }
      switch (kind) {
        case "form": {
          const row = requireRow(
            await orm
              .select()
              .from(forms)
              .where(and(this.inWorkspace(forms), eq(forms.id, id)))
              .get(),
            kind,
            id,
          );
          if (row.status === "archived" && !pinnedFormVersion)
            throw new ProjectCloneError("invalid", "アーカイブされたフォームは複製できません");
          const published = await orm
            .select()
            .from(formVersions)
            .where(
              and(
                this.inWorkspace(formVersions),
                eq(formVersions.formId, id),
                isNotNull(formVersions.publishedAt),
              ),
            )
            .orderBy(desc(formVersions.version))
            .get();
          const version =
            pinnedFormVersion ??
            published ??
            (await orm
              .select()
              .from(formVersions)
              .where(
                and(
                  this.inWorkspace(formVersions),
                  eq(formVersions.formId, id),
                  eq(formVersions.version, row.version),
                ),
              )
              .get());
          add(
            kind,
            version
              ? {
                  ...row,
                  version: version.version,
                  definition: version.sourceDefinition ?? version.definition,
                  sourceDefinition: version.sourceDefinition,
                  successMessage: version.sourceSuccessMessage ?? version.successMessage,
                  sourceSuccessMessage: version.sourceSuccessMessage,
                  allowedDomains: version.allowedDomains,
                  turnstileEnabled: version.turnstileEnabled,
                  variableProjectId: version.variableProjectId,
                }
              : row,
            linked,
          );
          if (version) add("form_version", version);
          const intent = await orm
            .select()
            .from(formProgramBindings)
            .where(and(this.inWorkspace(formProgramBindings), eq(formProgramBindings.formId, id)))
            .get();
          const binding = version?.programBinding
            ? {
                workspaceId: this.context.workspaceId,
                formId: id,
                updatedAt: row.updatedAt,
                ...(JSON.parse(version.programBinding) as Record<string, unknown>),
              }
            : version?.publishedAt
              ? null
              : intent;
          if (binding) add("form_binding", binding, false, id);
          break;
        }
        case "landing_page": {
          const row = requireRow(
            await orm
              .select()
              .from(landingPages)
              .where(and(this.inWorkspace(landingPages), eq(landingPages.id, id)))
              .get(),
            kind,
            id,
          );
          if (row.status === "archived")
            throw new ProjectCloneError("invalid", "アーカイブされたLPは複製できません");
          const snapshot = add(kind, row, linked);
          const versionId = row.publishedVersionId ?? row.currentVersionId;
          if (!versionId) throw new ProjectCloneError("invalid", "LPの複製元の版がありません");
          snapshot.row = { ...row, currentVersionId: versionId };
          await capturePageVersion(versionId, id);
          for (const experiment of await orm
            .select()
            .from(landingExperiments)
            .where(and(this.inWorkspace(landingExperiments), eq(landingExperiments.pageId, id)))) {
            add("experiment", experiment);
            for (const variant of JSON.parse(experiment.variants) as Array<{
              pageVersionId: string;
            }>)
              await capturePageVersion(variant.pageVersionId, id);
          }
          for (const content of await orm
            .select()
            .from(dynamicContents)
            .where(and(this.inWorkspace(dynamicContents), eq(dynamicContents.pageId, id))))
            add("dynamic_content", content, false, `${id}:${content.slotId}`);
          break;
        }
        case "automation": {
          const row = requireRow(
            await orm
              .select()
              .from(automations)
              .where(and(this.inWorkspace(automations), eq(automations.id, id)))
              .get(),
            kind,
            id,
          );
          if (row.status === "archived")
            throw new ProjectCloneError("invalid", "アーカイブされたAutomationは複製できません");
          const versionId = row.publishedVersionId ?? row.draftVersionId;
          if (!versionId)
            throw new ProjectCloneError("invalid", "Automationの複製元の版がありません");
          const version = requireRow(
            await orm
              .select()
              .from(automationVersions)
              .where(
                and(
                  this.inWorkspace(automationVersions),
                  eq(automationVersions.id, versionId),
                  eq(automationVersions.automationId, id),
                ),
              )
              .get(),
            "automation_version",
            versionId,
          );
          add("automation_version", version);
          const graph = JSON.parse(version.graph) as { variableProjectId?: string | null };
          add(
            kind,
            {
              ...row,
              draftVersionId: versionId,
              variableProjectId: graph.variableProjectId ?? null,
            },
            linked,
          );
          break;
        }
        case "segment":
          add(
            kind,
            requireRow(
              await orm
                .select()
                .from(segments)
                .where(and(this.inWorkspace(segments), eq(segments.id, id)))
                .get(),
              kind,
              id,
            ),
            linked,
          );
          break;
        case "redirect": {
          const row = requireRow(
            await orm
              .select()
              .from(customRedirects)
              .where(
                and(
                  this.inWorkspace(customRedirects),
                  eq(customRedirects.id, id),
                  isNull(customRedirects.archivedAt),
                ),
              )
              .get(),
            kind,
            id,
          );
          add(kind, row, linked);
          break;
        }
        case "email_sequence": {
          const row = requireRow(
            await orm
              .select()
              .from(emailTemplates)
              .where(
                and(
                  this.inWorkspace(emailTemplates),
                  eq(emailTemplates.id, id),
                  isNull(emailTemplates.archivedAt),
                ),
              )
              .get(),
            kind,
            id,
          );
          if (row.purpose !== "transactional")
            throw new ProjectCloneError(
              "invalid",
              "複製できるメールはTransactionalテンプレートのみです",
            );
          add(
            kind,
            {
              ...row,
              draftSubject: row.publishedSubject ?? row.draftSubject,
              draftContent: row.publishedContent ?? row.draftContent,
            },
            linked,
          );
          break;
        }
      }
    };
    for (const link of links)
      await captureResource(link.resourceType as ProjectResourceType, link.resourceId, true);
    // Add future configuration adapters here; each is a snapshot, never live source data.
    result.snapshots = [...snapshots.values()];
    validateCloneProgramBindings(result);
    return result;
  }
}
