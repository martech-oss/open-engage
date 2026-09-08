import { and, desc, eq, ne } from "drizzle-orm";

import { formHandlerSchema, type FormHandlerWrite } from "@openengage/core/web";

import { organization } from "../auth/schema";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { WorkspaceRepository, DatabaseRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { formHandlers, forms } from "./schema";

export class FormHandlerRepository extends WorkspaceRepository {
  async list() {
    const rows = await this.database.orm
      .select()
      .from(formHandlers)
      .where(this.inWorkspace(formHandlers))
      .orderBy(desc(formHandlers.updatedAt));
    return rows.map((row) =>
      formHandlerSchema.parse({
        ...row,
        fieldMapping: JSON.parse(row.fieldMapping),
        allowedDomains: JSON.parse(row.allowedDomains),
      }),
    );
  }
  async create(input: FormHandlerWrite) {
    const id = uuidv7(),
      now = nowIso();
    await this.database.orm.insert(formHandlers).values({
      ...input,
      id,
      workspaceId: this.context.workspaceId,
      fieldMapping: JSON.stringify(input.fieldMapping),
      allowedDomains: JSON.stringify(input.allowedDomains),
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }
  async update(id: string, input: FormHandlerWrite) {
    return changedExactlyOne(
      await this.database.orm
        .update(formHandlers)
        .set({
          ...input,
          fieldMapping: JSON.stringify(input.fieldMapping),
          allowedDomains: JSON.stringify(input.allowedDomains),
          updatedAt: nowIso(),
        })
        .where(and(this.inWorkspace(formHandlers), eq(formHandlers.id, id))),
    );
  }
  async delete(id: string) {
    return changedExactlyOne(
      await this.database.orm
        .delete(formHandlers)
        .where(and(this.inWorkspace(formHandlers), eq(formHandlers.id, id))),
    );
  }
}
export class PublicFormHandlerRepository extends DatabaseRepository {
  async find(workspaceSlug: string, slug: string) {
    const row = await this.database.orm
      .select({ handler: formHandlers, formSlug: forms.slug })
      .from(formHandlers)
      .innerJoin(organization, eq(organization.id, formHandlers.workspaceId))
      .innerJoin(
        forms,
        and(eq(forms.id, formHandlers.formId), eq(forms.workspaceId, formHandlers.workspaceId)),
      )
      .where(
        and(
          eq(organization.slug, workspaceSlug),
          eq(formHandlers.slug, slug),
          eq(formHandlers.enabled, true),
          eq(forms.status, "published"),
        ),
      )
      .get();
    return row
      ? {
          ...formHandlerSchema.parse({
            ...row.handler,
            fieldMapping: JSON.parse(row.handler.fieldMapping),
            allowedDomains: JSON.parse(row.handler.allowedDomains),
          }),
          workspaceId: row.handler.workspaceId,
          formSlug: row.formSlug,
        }
      : null;
  }
  async formFields(workspaceId: string, formId: string) {
    const row = await this.database.orm
      .select({ definition: forms.definition })
      .from(forms)
      .where(
        and(eq(forms.workspaceId, workspaceId), eq(forms.id, formId), ne(forms.status, "archived")),
      )
      .get();
    return row ? (JSON.parse(row.definition) as unknown) : null;
  }
}
