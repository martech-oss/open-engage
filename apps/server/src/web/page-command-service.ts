import type { WorkspaceContext } from "@openengage/core/shared";
import {
  emptyLandingPageDocument,
  type LandingPageCreate,
  type LandingPageWrite,
} from "@openengage/core/web";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { isConstraintError, isUniqueConstraintError } from "@openengage/database/shared";
import { LandingPageRepository } from "@openengage/database/web";

import type { RuntimeEnv } from "../env";
import { availableSlug } from "../workspaces/slug-service";
import { publishLandingPage } from "./landing-publication-service";
import { validateLandingReferences } from "./landing-reference-validation";
import { sanitizeLandingDocument } from "./landing-safety";

const PAGE_SLUG_UNIQUE_COLUMNS = ["landing_pages.workspace_id", "landing_pages.slug"] as const;

type PageWriteOutcome =
  | { kind: "ok"; id: string; versionId: string }
  | { kind: "invalid"; cause: unknown }
  | { kind: "slug_taken"; cause: unknown };

type PageUpdateOutcome =
  | PageWriteOutcome
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "conflict"; cause?: unknown };

export class PageCommandService {
  private readonly repository: LandingPageRepository;

  public constructor(
    private readonly database: OpenEngageDatabase,
    private readonly workspace: WorkspaceContext,
    private readonly env: RuntimeEnv,
  ) {
    this.repository = new LandingPageRepository(database, workspace);
  }

  public async create(input: LandingPageCreate): Promise<PageWriteOutcome> {
    const sourceDocument =
      input.document ?? (!input.content ? emptyLandingPageDocument(input.name) : undefined);
    let document;
    if (sourceDocument) {
      try {
        document = await this.prepareDocument(sourceDocument);
      } catch (error) {
        return { kind: "invalid", cause: error };
      }
    }
    let slug =
      input.slug ??
      (await availableSlug(input.name, "landing-page", (candidate) =>
        this.repository.isSlugAvailable(candidate),
      ));
    for (;;) {
      let publishing = false;
      try {
        const created = await this.repository.createLandingPage({
          ...input,
          ...(document ? { document, status: "draft" as const } : {}),
          slug,
        });
        if (document && input.status === "published") {
          publishing = true;
          // Creation persists the draft first. Publication failures leave it available,
          // and returned not_found/conflict outcomes are intentionally unchanged here.
          await publishLandingPage(this.database, this.workspace.workspaceId, this.env, {
            id: created.id,
            versionId: created.versionId,
            baseVersionId: created.versionId,
          });
        }
        return { kind: "ok", ...created };
      } catch (error) {
        if (!isUniqueConstraintError(error, PAGE_SLUG_UNIQUE_COLUMNS)) {
          if (publishing) return { kind: "invalid", cause: error };
          throw error;
        }
        if (input.slug) return { kind: "slug_taken", cause: error };
        slug = await availableSlug(input.name, "landing-page", (candidate) =>
          this.repository.isSlugAvailable(candidate),
        );
      }
    }
  }

  public async update(input: LandingPageWrite & { id: string }): Promise<PageUpdateOutcome> {
    const { id, ...changes } = input;
    let document;
    if (changes.document) {
      if (!changes.baseVersionId) return { kind: "conflict" };
      try {
        document = await this.prepareDocument(changes.document);
      } catch (error) {
        return { kind: "invalid", cause: error };
      }
    }
    try {
      return await this.repository.updateLandingPage(id, {
        ...changes,
        ...(document ? { document } : {}),
      });
    } catch (error) {
      if (isUniqueConstraintError(error, PAGE_SLUG_UNIQUE_COLUMNS))
        return { kind: "slug_taken", cause: error };
      if (isConstraintError(error)) return { kind: "conflict", cause: error };
      throw error;
    }
  }

  private async prepareDocument(document: NonNullable<LandingPageWrite["document"]>) {
    const sanitized = await sanitizeLandingDocument(document);
    await validateLandingReferences(this.database, this.workspace.workspaceId, sanitized, this.env);
    return sanitized;
  }
}
