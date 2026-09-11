import { ZodError } from "zod";

import { VariableResolutionError } from "@openengage/core/projects";
import type { WorkspaceContext } from "@openengage/core/shared";
import type { SignupFormCreate, SignupFormWrite } from "@openengage/core/web";
import type { OpenEngageDatabase } from "@openengage/database/client";
import { VariableRepositoryError } from "@openengage/database/projects";
import { isUniqueConstraintError } from "@openengage/database/shared";
import { SignupFormRepository } from "@openengage/database/web";

import type { RuntimeEnv } from "../env";
import { availableSlug } from "../workspaces/slug-service";
import { hasTurnstileConfiguration } from "./config";

const FORM_SLUG_UNIQUE_COLUMNS = ["forms.workspace_id", "forms.slug"] as const;

type FormWriteOutcome =
  | { kind: "ok"; id: string }
  | { kind: "turnstile_not_configured" }
  | { kind: "variable_invalid"; cause: unknown }
  | { kind: "slug_taken"; cause: unknown };

export class FormCommandService {
  private readonly repository: SignupFormRepository;

  public constructor(
    database: OpenEngageDatabase,
    workspace: WorkspaceContext,
    private readonly env: RuntimeEnv,
  ) {
    this.repository = new SignupFormRepository(database, workspace);
  }

  public async create(input: SignupFormCreate): Promise<FormWriteOutcome> {
    if (
      input.status === "published" &&
      input.turnstileEnabled &&
      !hasTurnstileConfiguration(this.env)
    )
      return { kind: "turnstile_not_configured" };
    let slug =
      input.slug ??
      (await availableSlug(input.name, "signup-form", (candidate) =>
        this.repository.isSlugAvailable(candidate),
      ));
    for (;;) {
      try {
        const created = await this.repository.createSignupForm({ ...input, slug });
        return { kind: "ok", id: created.id };
      } catch (error) {
        if (isVariableError(error)) return { kind: "variable_invalid", cause: error };
        if (!isUniqueConstraintError(error, FORM_SLUG_UNIQUE_COLUMNS)) throw error;
        if (input.slug) return { kind: "slug_taken", cause: error };
        slug = await availableSlug(input.name, "signup-form", (candidate) =>
          this.repository.isSlugAvailable(candidate),
        );
      }
    }
  }

  public async update(
    input: SignupFormWrite & { id: string },
  ): Promise<FormWriteOutcome | { kind: "not_found" }> {
    if (
      input.status === "published" &&
      input.turnstileEnabled &&
      !hasTurnstileConfiguration(this.env)
    )
      return { kind: "turnstile_not_configured" };
    const { id, ...changes } = input;
    try {
      if (!(await this.repository.updateSignupForm(id, changes))) return { kind: "not_found" };
    } catch (error) {
      if (isVariableError(error)) return { kind: "variable_invalid", cause: error };
      if (isUniqueConstraintError(error, FORM_SLUG_UNIQUE_COLUMNS))
        return { kind: "slug_taken", cause: error };
      throw error;
    }
    return { kind: "ok", id };
  }
}

function isVariableError(error: unknown): boolean {
  return (
    error instanceof VariableResolutionError ||
    error instanceof VariableRepositoryError ||
    error instanceof ZodError
  );
}
