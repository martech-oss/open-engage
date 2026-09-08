import { and, eq } from "drizzle-orm";

import {
  programBindingSchema,
  programBindingIntentSchema,
  type ProgramBinding,
  type ProgramBindingIntent,
} from "@openengage/core/projects";

import { nowIso } from "../shared/database-utils";
import { WorkspaceRepository } from "../shared/repository-base";
import { forms } from "../web/schema";
import { formProgramBindings } from "./form-program-schema";
import { ProjectProgramRepository, ProgramError } from "./program-repository";
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
  public async set(formId: string, binding: ProgramBinding | null) {
    const form = await this.database.orm
      .select({ id: forms.id })
      .from(forms)
      .where(and(this.inWorkspace(forms), eq(forms.id, formId)))
      .get();
    if (!form) throw new ProgramError("not_found", "Form not found in workspace");
    if (!binding) {
      await this.database.orm
        .delete(formProgramBindings)
        .where(and(this.inWorkspace(formProgramBindings), eq(formProgramBindings.formId, formId)));
      return;
    }
    const parsed = await this.validate(binding);
    await this.database.orm
      .insert(formProgramBindings)
      .values({ workspaceId: this.context.workspaceId, formId, ...parsed, updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: [formProgramBindings.workspaceId, formProgramBindings.formId],
        set: { ...parsed, updatedAt: nowIso() },
      });
  }
}
