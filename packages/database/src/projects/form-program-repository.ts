import { and, eq, sql } from "drizzle-orm";

import {
  programBindingSchema,
  programBindingIntentSchema,
  type ProgramBinding,
  type ProgramBindingIntent,
} from "@openengage/core/projects";

import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { forms } from "../web/schema";
import { formProgramBindings } from "./form-program-schema";
import { ProjectProgramRepository, ProgramError } from "./program-repository";
import { projects } from "./schema";
export class FormProgramRepository extends WorkspaceRepository {
  public async getIntent(formId: string): Promise<ProgramBindingIntent | null> {
    const row = await this.database.orm
      .select({ binding: formProgramBindings })
      .from(formProgramBindings)
      .innerJoin(
        forms,
        and(
          eq(forms.id, formProgramBindings.formId),
          eq(forms.workspaceId, formProgramBindings.workspaceId),
        ),
      )
      .where(and(this.inWorkspace(formProgramBindings), eq(formProgramBindings.formId, formId)))
      .get();
    return row ? programBindingIntentSchema.parse(row.binding) : null;
  }
  /** Publishing resolves draft clone intent against the destination Project's published version. */
  public async get(formId: string): Promise<ProgramBinding | null> {
    const intent = await this.getIntent(formId);
    if (!intent) return null;
    const version =
      intent.definitionVersion ??
      (await new ProjectProgramRepository(this.database, this.context).get(intent.projectId))
        ?.publishedVersion;
    if (!version)
      throw new ProgramError(
        "invalid",
        "Publish the destination program before publishing its form",
      );
    return this.validate({ ...intent, definitionVersion: version });
  }
  public async validate(
    binding: ProgramBinding,
    measurementProjectId?: string | null,
  ): Promise<ProgramBinding> {
    const parsed = programBindingSchema.parse(binding);
    if (measurementProjectId && measurementProjectId !== parsed.projectId)
      throw new ProgramError("invalid", "Form program does not match verified measurement Project");
    const definition = await new ProjectProgramRepository(this.database, this.context).definition(
      parsed.projectId,
      parsed.definitionVersion,
    );
    if (!definition.statuses.some((s) => s.id === parsed.statusId))
      throw new ProgramError(
        "invalid",
        "Form program status does not exist in published definition",
      );
    return parsed;
  }
  public async list(projectId: string) {
    await new ProjectProgramRepository(this.database, this.context).project(projectId);
    return this.database.orm
      .select({
        formId: formProgramBindings.formId,
        formName: forms.name,
        projectId: formProgramBindings.projectId,
        definitionVersion: formProgramBindings.definitionVersion,
        statusId: formProgramBindings.statusId,
      })
      .from(formProgramBindings)
      .innerJoin(
        forms,
        and(
          eq(forms.id, formProgramBindings.formId),
          eq(forms.workspaceId, formProgramBindings.workspaceId),
        ),
      )
      .where(
        and(this.inWorkspace(formProgramBindings), eq(formProgramBindings.projectId, projectId)),
      );
  }
  /**
   * `expectedProjectId` is the binding's owner when the caller authorized the
   * change (null for an unbound form). The write applies only if that still
   * holds and a new target Project is still active, so a concurrent rebind or
   * archive between the check and the write surfaces as a conflict.
   */
  public async set(
    formId: string,
    binding: ProgramBinding | null,
    expectedProjectId: string | null,
  ) {
    const form = await this.database.orm
      .select({ id: forms.id })
      .from(forms)
      .where(and(this.inWorkspace(forms), eq(forms.id, formId)))
      .get();
    if (!form) throw new ProgramError("not_found", "Form not found in workspace");
    if (!binding) {
      // Releasing an unbound form must not remove a binding someone else just made.
      if (expectedProjectId === null) return;
      await this.database.orm
        .delete(formProgramBindings)
        .where(
          and(
            this.inWorkspace(formProgramBindings),
            eq(formProgramBindings.formId, formId),
            eq(formProgramBindings.projectId, expectedProjectId),
          ),
        );
      return;
    }
    const parsed = await this.validate(binding);
    const now = nowIso();
    const targetActive = sql`EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.workspaceId} = ${this.context.workspaceId} AND ${projects.id} = ${parsed.projectId} AND ${projects.archivedAt} IS NULL)`;
    const result =
      expectedProjectId === null
        ? await this.database.orm
            .insert(formProgramBindings)
            .select(
              sql`SELECT ${this.context.workspaceId}, ${formId}, ${parsed.projectId}, ${parsed.definitionVersion}, ${parsed.statusId}, ${now} WHERE ${targetActive}`,
            )
            .onConflictDoNothing()
        : await this.database.orm
            .update(formProgramBindings)
            .set({ ...parsed, updatedAt: now })
            .where(
              and(
                this.inWorkspace(formProgramBindings),
                eq(formProgramBindings.formId, formId),
                eq(formProgramBindings.projectId, expectedProjectId),
                targetActive,
              ),
            );
    if (!changedExactlyOne(result))
      throw new ProgramError("conflict", "The form binding changed; reload and try again");
  }
}
