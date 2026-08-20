import { and, desc, eq, ne, sql } from "drizzle-orm";

import { stringArraySchema } from "@openengage/core/shared";
import {
  signupFormDefinitionSchema,
  signupFormSchema,
  type SignupForm,
  type SignupFormWrite,
} from "@openengage/core/web";

import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { forms, formSubmissions } from "./schema";

const formDefinitionCodec = defineJsonCodec(signupFormDefinitionSchema, "forms.definition");
const formAllowedDomainsCodec = defineJsonCodec(stringArraySchema, "forms.allowed_domains");

export class SignupFormRepository extends WorkspaceRepository {
  public async listSignupForms(): Promise<SignupForm[]> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const rows = await orm
      .select({
        id: forms.id,
        name: forms.name,
        slug: forms.slug,
        status: forms.status,
        version: forms.version,
        definition: forms.definition,
        allowedDomains: forms.allowedDomains,
        turnstileEnabled: forms.turnstileEnabled,
        successMessage: forms.successMessage,
        // Correlated subquery embedded as a real builder (not a `${col}`
        // interpolation): see the module doc for why that matters.
        submissionCount: sql<number>`${orm.$count(
          formSubmissions,
          and(
            eq(formSubmissions.workspaceId, forms.workspaceId),
            eq(formSubmissions.formId, forms.id),
          ),
        )}`.mapWith(Number),
        createdAt: forms.createdAt,
        updatedAt: forms.updatedAt,
      })
      .from(forms)
      .where(and(eq(forms.workspaceId, workspaceId), ne(forms.status, "archived")))
      .orderBy(desc(forms.updatedAt))
      .limit(UNPAGINATED_LIST_LIMIT);
    return rows.map((row) =>
      signupFormSchema.parse({
        ...row,
        definition: formDefinitionCodec.decode(row.definition),
        allowedDomains: formAllowedDomainsCodec.decode(row.allowedDomains),
      }),
    );
  }

  public async createSignupForm(input: SignupFormWrite): Promise<{ id: string }> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(forms).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      status: input.status,
      definition: formDefinitionCodec.encode(input.definition),
      allowedDomains: formAllowedDomainsCodec.encode(input.allowedDomains),
      turnstileEnabled: input.turnstileEnabled,
      successMessage: input.successMessage,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async updateSignupForm(id: string, input: SignupFormWrite): Promise<boolean> {
    const result = await this.database.orm
      .update(forms)
      .set({
        name: input.name,
        slug: input.slug,
        status: input.status,
        version: sql`${forms.version} + 1`,
        definition: formDefinitionCodec.encode(input.definition),
        allowedDomains: formAllowedDomainsCodec.encode(input.allowedDomains),
        turnstileEnabled: input.turnstileEnabled,
        successMessage: input.successMessage,
        updatedAt: nowIso(),
      })
      .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived")));
    return changedExactlyOne(result);
  }

  public async archiveSignupForm(id: string): Promise<boolean> {
    const result = await this.database.orm
      .update(forms)
      .set({ status: "archived", updatedAt: nowIso() })
      .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived")));
    return changedExactlyOne(result);
  }
}
