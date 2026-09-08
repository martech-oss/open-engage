import { and, desc, eq, isNull, ne, or, sql, lt, inArray } from "drizzle-orm";

import {
  variableSnapshotSchema,
  type ProgramBinding,
  type VariableSnapshot,
} from "@openengage/core/projects";
import {
  landingPageDocumentSchema,
  landingFormBindingSchema,
  landingGenerationJobSchema,
  type LandingPageDocument,
  type LandingFormBinding,
} from "@openengage/core/web";

import { GeneratedEmailImageRepository } from "../messaging/email-design-repository";
import { generatedEmailImages } from "../messaging/schema";
import { projects } from "../projects/schema";
import { nowIso } from "../shared/database-utils";
import { DatabaseRepository, WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import {
  forms,
  formVersions,
  landingGenerationJobs,
  landingPages,
  landingPageVersions,
} from "./schema";

export class LandingDesignRepository extends WorkspaceRepository {
  async page(id: string) {
    return this.database.orm
      .select()
      .from(landingPages)
      .where(
        and(
          this.inWorkspace(landingPages),
          eq(landingPages.id, id),
          ne(landingPages.status, "archived"),
        ),
      )
      .get();
  }
  async version(pageId: string, id: string) {
    const row = await this.database.orm
      .select()
      .from(landingPageVersions)
      .where(
        and(
          this.inWorkspace(landingPageVersions),
          eq(landingPageVersions.pageId, pageId),
          eq(landingPageVersions.id, id),
        ),
      )
      .get();
    return row?.document
      ? {
          ...row,
          document: landingPageDocumentSchema.parse(JSON.parse(row.document)),
          publishedDocument: row.publishedDocument
            ? landingPageDocumentSchema.parse(JSON.parse(row.publishedDocument))
            : null,
          variableSnapshot: row.variableSnapshot
            ? variableSnapshotSchema.parse(JSON.parse(row.variableSnapshot))
            : null,
          formBindings: landingFormBindingSchema.array().parse(JSON.parse(row.formBindings)),
        }
      : null;
  }
  async versions(pageId: string) {
    const rows = await this.database.orm
      .select()
      .from(landingPageVersions)
      .where(and(this.inWorkspace(landingPageVersions), eq(landingPageVersions.pageId, pageId)))
      .orderBy(desc(landingPageVersions.version))
      .limit(100);
    return rows
      .filter((row) => row.document)
      .map((row) => ({
        ...row,
        document: landingPageDocumentSchema.parse(JSON.parse(row.document!)),
        publishedDocument: row.publishedDocument
          ? landingPageDocumentSchema.parse(JSON.parse(row.publishedDocument))
          : null,
        variableSnapshot: row.variableSnapshot
          ? variableSnapshotSchema.parse(JSON.parse(row.variableSnapshot))
          : null,
        formBindings: landingFormBindingSchema.array().parse(JSON.parse(row.formBindings)),
      }));
  }
  async validProject(id: string) {
    return Boolean(
      await this.database.orm
        .select({ id: projects.id })
        .from(projects)
        .where(and(this.inWorkspace(projects), eq(projects.id, id), isNull(projects.archivedAt)))
        .get(),
    );
  }
  async validForm(id: string) {
    return Boolean(
      await this.database.orm
        .select({ id: forms.id })
        .from(forms)
        .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived")))
        .get(),
    );
  }

  /** All form snapshots and the public pointer commit together. Failed CAS rolls the entire batch back. */
  async publish(
    pageId: string,
    versionId: string,
    expectedDraftId: string,
    publication?: {
      document: LandingPageDocument;
      snapshot: VariableSnapshot;
      formSnapshots?: Record<string, VariableSnapshot>;
      programBindings?: Record<string, ProgramBinding | null>;
    },
  ) {
    const version = await this.version(pageId, versionId);
    if (!version) return false;
    const orm = this.database.orm,
      now = nowIso(),
      workspaceId = this.context.workspaceId;
    const publishedDocument =
      version.publishedDocument ?? publication?.document ?? version.document;
    const snapshot = version.variableSnapshot ?? publication?.snapshot ?? null;
    const bindings: LandingFormBinding[] =
      version.publishedAt && version.formBindings.length
        ? version.formBindings
        : version.document.forms.map((form) => ({
            refId: form.refId,
            formId: uuidv7(),
            formVersionId: uuidv7(),
          }));
    const writes = version.publishedAt
      ? []
      : publishedDocument.forms.flatMap((form) => {
          const binding = bindings.find((item) => item.refId === form.refId)!;
          const definition = JSON.stringify(form.definition);
          const sourceForm = version.document.forms.find((item) => item.refId === form.refId)!;
          const variableFields = {
            sourceDefinition: JSON.stringify(sourceForm.definition),
            sourceSuccessMessage: sourceForm.successMessage,
            variableProjectId:
              publication?.formSnapshots?.[form.refId]?.projectId ??
              (form.formId ? null : (version.document.variableProjectId ?? null)),
            variableSnapshot: publication?.formSnapshots?.[form.refId]
              ? JSON.stringify(publication.formSnapshots[form.refId])
              : snapshot
                ? JSON.stringify(snapshot)
                : null,
          };
          return [
            orm.insert(forms).values({
              id: binding.formId,
              workspaceId,
              name: form.name,
              slug: `lp-${binding.formId}`,
              status: "published",
              definition,
              ...variableFields,
              allowedDomains: "[]",
              turnstileEnabled: form.turnstileEnabled,
              successMessage: form.successMessage,
              createdAt: now,
              updatedAt: now,
            }),
            orm.insert(formVersions).values({
              id: binding.formVersionId,
              workspaceId,
              formId: binding.formId,
              publishedAt: now,
              programBinding: publication?.programBindings?.[form.refId]
                ? JSON.stringify(publication.programBindings[form.refId])
                : null,
              version: 1,
              definition,
              ...variableFields,
              allowedDomains: "[]",
              turnstileEnabled: form.turnstileEnabled,
              successMessage: form.successMessage,
              createdAt: now,
            }),
          ];
        });
    await orm.batch([
      orm
        .update(landingPages)
        .set({
          publishedVersionId: versionId,
          status: "published",
          updatedAt: now,
          // A stale operation must fail even if its preceding preparation succeeded.
          name: sql`CASE WHEN ${landingPages.currentVersionId} = ${expectedDraftId} AND ${landingPages.status} != 'archived' AND EXISTS (SELECT 1 FROM landing_page_versions WHERE id = ${versionId} AND page_id = ${pageId} AND workspace_id = ${workspaceId} AND published_at IS ${version.publishedAt} AND form_bindings = ${JSON.stringify(version.formBindings)}) THEN ${landingPages.name} ELSE NULL END`,
        })
        .where(and(this.inWorkspace(landingPages), eq(landingPages.id, pageId))),
      ...new GeneratedEmailImageRepository(this.database).claimStatements(
        workspaceId,
        version.document.images.map((image) => image.assetId),
        now,
      ),
      ...writes,
      orm
        .update(landingPageVersions)
        .set({
          formBindings: JSON.stringify(bindings),
          publishedAt: version.publishedAt ?? now,
          publishedDocument: JSON.stringify(publishedDocument),
          variableSnapshot: snapshot ? JSON.stringify(snapshot) : null,
        })
        .where(
          and(
            this.inWorkspace(landingPageVersions),
            eq(landingPageVersions.id, versionId),
            eq(landingPageVersions.pageId, pageId),
          ),
        ),
    ]);
    return true;
  }

  async queue(input: {
    pageId: string;
    baseVersionId: string;
    requestKey: string;
    prompt: string;
    userId: string;
  }) {
    const now = nowIso(),
      id = uuidv7();
    await this.database.orm
      .insert(landingGenerationJobs)
      .values({
        id,
        workspaceId: this.context.workspaceId,
        ...input,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    return this.database.orm
      .select()
      .from(landingGenerationJobs)
      .where(
        and(
          this.inWorkspace(landingGenerationJobs),
          eq(landingGenerationJobs.pageId, input.pageId),
          eq(landingGenerationJobs.requestKey, input.requestKey),
        ),
      )
      .get();
  }
  /** Explicit retries retain the job ID and may never apply to a newer draft. */
  async retryGeneration(pageId: string, jobId: string, userId: string) {
    const workspaceId = this.context.workspaceId;
    const currentBase = sql`EXISTS(SELECT 1 FROM landing_pages p WHERE p.id=${pageId} AND p.workspace_id=${workspaceId} AND p.current_version_id=${landingGenerationJobs.baseVersionId} AND p.status!='archived')`;
    const scope = and(
      this.inWorkspace(landingGenerationJobs),
      eq(landingGenerationJobs.id, jobId),
      eq(landingGenerationJobs.pageId, pageId),
      currentBase,
    );
    const changed = await this.database.orm
      .update(landingGenerationJobs)
      .set({
        status: "queued",
        error: null,
        leaseId: null,
        leaseExpiresAt: null,
        userId,
        updatedAt: nowIso(),
      })
      .where(
        and(
          scope,
          eq(landingGenerationJobs.status, "failed"),
          sql`CASE WHEN json_valid(${landingGenerationJobs.error}) THEN json_extract(${landingGenerationJobs.error},'$.kind') END='retryable'`,
        ),
      )
      .returning({ id: landingGenerationJobs.id })
      .get();
    if (changed) return true;
    // A double click/ambiguous response must not create another request.
    return Boolean(
      await this.database.orm
        .select({ id: landingGenerationJobs.id })
        .from(landingGenerationJobs)
        .where(and(scope, inArray(landingGenerationJobs.status, ["queued", "running"])))
        .get(),
    );
  }

  async jobs(pageId: string) {
    const rows = await this.database.orm
      .select()
      .from(landingGenerationJobs)
      .where(and(this.inWorkspace(landingGenerationJobs), eq(landingGenerationJobs.pageId, pageId)))
      .orderBy(desc(landingGenerationJobs.createdAt))
      .limit(100);
    return rows.map((row) => {
      let error = row.error,
        failureKind: "retryable" | "configuration" | "conflict" | null =
          row.status === "conflict" ? "conflict" : null;
      try {
        const detail = JSON.parse(row.error ?? "null") as {
          message: string;
          kind: "retryable" | "configuration" | "conflict";
        } | null;
        if (detail) {
          error = detail.message;
          failureKind = detail.kind;
        }
      } catch {
        /* Existing plain error text remains readable. */
      }
      return landingGenerationJobSchema.parse({
        ...row,
        error,
        failureKind,
        retryable: failureKind === "retryable",
      });
    });
  }

  async applyGeneration(input: {
    jobId: string;
    leaseId: string;
    pageId: string;
    baseVersionId: string;
    document: LandingPageDocument;
    explanation: string;
  }) {
    const page = await this.page(input.pageId),
      base = await this.version(input.pageId, input.baseVersionId);
    if (!page || !base || page.currentVersionId !== input.baseVersionId) return null;
    const id = uuidv7(),
      now = nowIso(),
      workspaceId = this.context.workspaceId,
      orm = this.database.orm;
    await orm.batch([
      orm.insert(landingPageVersions).values({
        id,
        workspaceId,
        pageId: sql`CASE WHEN EXISTS (SELECT 1 FROM landing_pages WHERE id = ${input.pageId} AND workspace_id = ${workspaceId} AND current_version_id = ${input.baseVersionId} AND status != 'archived') AND EXISTS (SELECT 1 FROM landing_generation_jobs WHERE id = ${input.jobId} AND workspace_id = ${workspaceId} AND lease_id = ${input.leaseId} AND status = 'running') THEN ${input.pageId} ELSE NULL END`,
        version: sql`(SELECT COALESCE(MAX(version), 0) + 1 FROM landing_page_versions WHERE workspace_id = ${workspaceId} AND page_id = ${input.pageId})`,
        contentDocument: JSON.stringify({ schemaVersion: 1, blocks: [] }),
        document: JSON.stringify(input.document),
        formBindings: "[]",
        publishedAt: null,
        createdAt: now,
      }),
      orm
        .update(landingPages)
        .set({ currentVersionId: id, updatedAt: now })
        .where(
          and(
            this.inWorkspace(landingPages),
            eq(landingPages.id, input.pageId),
            eq(landingPages.currentVersionId, input.baseVersionId),
          ),
        ),
      orm
        .update(landingGenerationJobs)
        .set({
          status: "completed",
          resultVersionId: id,
          explanation: input.explanation,
          error: null,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            this.inWorkspace(landingGenerationJobs),
            eq(landingGenerationJobs.id, input.jobId),
            eq(landingGenerationJobs.leaseId, input.leaseId),
          ),
        ),
      ...(input.document.images.length
        ? [
            orm
              .update(generatedEmailImages)
              .set({ claimedAt: now })
              .where(
                and(
                  eq(generatedEmailImages.workspaceId, workspaceId),
                  inArray(
                    generatedEmailImages.assetId,
                    input.document.images.map((image) => image.assetId),
                  ),
                  isNull(generatedEmailImages.claimedAt),
                ),
              ),
          ]
        : []),
    ]);
    return id;
  }
}

export class LandingGenerationRepository extends DatabaseRepository {
  async claim(id: string) {
    const now = nowIso(),
      leaseId = uuidv7();
    return this.database.orm
      .update(landingGenerationJobs)
      .set({
        status: "running",
        leaseId,
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        updatedAt: now,
      })
      .where(
        and(
          eq(landingGenerationJobs.id, id),
          or(
            eq(landingGenerationJobs.status, "queued"),
            and(
              eq(landingGenerationJobs.status, "running"),
              lt(landingGenerationJobs.leaseExpiresAt, now),
            ),
          ),
        ),
      )
      .returning()
      .get();
  }
  async finish(
    id: string,
    leaseId: string,
    input: {
      status: "completed" | "failed" | "conflict";
      resultVersionId?: string;
      explanation?: string;
      error?: string;
      failureKind?: "retryable" | "configuration" | "conflict";
    },
  ) {
    const { failureKind, ...changes } = input;
    await this.database.orm
      .update(landingGenerationJobs)
      .set({
        ...changes,
        ...(input.error && failureKind
          ? { error: JSON.stringify({ message: input.error, kind: failureKind }) }
          : {}),
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: nowIso(),
      })
      .where(and(eq(landingGenerationJobs.id, id), eq(landingGenerationJobs.leaseId, leaseId)));
  }
  async pending() {
    return this.database.orm
      .select({ id: landingGenerationJobs.id })
      .from(landingGenerationJobs)
      .where(
        or(
          eq(landingGenerationJobs.status, "queued"),
          and(
            eq(landingGenerationJobs.status, "running"),
            lt(landingGenerationJobs.leaseExpiresAt, nowIso()),
          ),
        ),
      )
      .limit(20);
  }
}
