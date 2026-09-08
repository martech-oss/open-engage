import { and, desc, eq, isNull, ne, or, sql, lt, inArray } from "drizzle-orm";

import {
  landingPageDocumentSchema,
  landingFormBindingSchema,
  landingGenerationJobSchema,
  type LandingPageDocument,
  type LandingFormBinding,
} from "@openengage/core/web";

import { organization } from "../auth/schema";
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
  async publish(pageId: string, versionId: string, expectedDraftId: string) {
    const version = await this.version(pageId, versionId);
    if (!version) return false;
    const orm = this.database.orm,
      now = nowIso(),
      workspaceId = this.context.workspaceId;
    const bindings: LandingFormBinding[] = version.formBindings.length
      ? version.formBindings
      : version.document.forms.map((form) => ({
          refId: form.refId,
          formId: uuidv7(),
          formVersionId: uuidv7(),
        }));
    const writes = version.publishedAt
      ? []
      : version.document.forms.flatMap((form) => {
          const binding = bindings.find((item) => item.refId === form.refId)!;
          const definition = JSON.stringify(form.definition);
          return [
            orm.insert(forms).values({
              id: binding.formId,
              workspaceId,
              name: form.name,
              slug: `lp-${binding.formId}`,
              status: "published",
              definition,
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
              version: 1,
              definition,
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
      ...writes,
      orm
        .update(landingPageVersions)
        .set({ formBindings: JSON.stringify(bindings), publishedAt: version.publishedAt ?? now })
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
        version: base.version + 1,
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

export class PublicLandingRepository extends DatabaseRepository {
  async page(workspaceSlug: string, slug: string) {
    return this.database.orm
      .select({
        id: landingPages.id,
        workspaceId: landingPages.workspaceId,
        publishedVersionId: landingPages.publishedVersionId,
        currentVersionId: landingPages.currentVersionId,
        workspaceName: organization.name,
      })
      .from(landingPages)
      .innerJoin(organization, eq(organization.id, landingPages.workspaceId))
      .where(
        and(
          eq(organization.slug, workspaceSlug),
          eq(landingPages.slug, slug),
          eq(landingPages.status, "published"),
        ),
      )
      .get();
  }
  async pinnedForm(workspaceId: string, versionId: string) {
    const row = await this.database.orm
      .select()
      .from(formVersions)
      .where(and(eq(formVersions.workspaceId, workspaceId), eq(formVersions.id, versionId)))
      .get();
    if (!row) return null;
    const form = await this.database.orm
      .select({ name: forms.name })
      .from(forms)
      .where(and(eq(forms.workspaceId, workspaceId), eq(forms.id, row.formId)))
      .get();
    if (!form) return null;
    return {
      id: row.formId,
      workspaceId,
      name: form.name,
      definition: JSON.parse(row.definition) as LandingPageDocument["forms"][number]["definition"],
      allowedDomains: JSON.parse(row.allowedDomains) as string[],
      turnstileEnabled: row.turnstileEnabled,
      successMessage: row.successMessage,
    };
  }
}
