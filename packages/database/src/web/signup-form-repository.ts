import { and, desc, eq, ne, sql } from "drizzle-orm";

import { VariableResolutionError, variableSnapshotSchema } from "@openengage/core/projects";
import { stringArraySchema } from "@openengage/core/shared";
import {
  signupFormDefinitionSchema,
  resolveFormVariables,
  signupFormSchema,
  type SignupForm,
  type SignupFormWrite,
} from "@openengage/core/web";

import { FormProgramRepository } from "../projects/form-program-repository";
import { VariableRepository } from "../projects/variable-repository";
import { changedExactlyOne, nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { forms, formSubmissions, formVersions } from "./schema";

const formDefinitionCodec = defineJsonCodec(signupFormDefinitionSchema, "forms.definition");
const formAllowedDomainsCodec = defineJsonCodec(stringArraySchema, "forms.allowed_domains");

export class SignupFormRepository extends WorkspaceRepository {
  public async variableContext(id: string): Promise<{ projectId: string | null } | null> {
    return (
      (await this.database.orm
        .select({ projectId: forms.variableProjectId })
        .from(forms)
        .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived")))
        .get()) ?? null
    );
  }

  public async isSlugAvailable(slug: string): Promise<boolean> {
    const rows = await this.database.orm
      .select({ id: forms.id })
      .from(forms)
      .where(and(this.inWorkspace(forms), eq(forms.slug, slug)))
      .limit(1);
    return rows.length === 0;
  }

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
        sourceDefinition: forms.sourceDefinition,
        sourceSuccessMessage: forms.sourceSuccessMessage,
        variableProjectId: forms.variableProjectId,
        variableSnapshot: forms.variableSnapshot,
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
        definition: formDefinitionCodec.decode(row.sourceDefinition ?? row.definition),
        successMessage: row.sourceSuccessMessage ?? row.successMessage,
        variableSnapshot: row.variableSnapshot
          ? variableSnapshotSchema.parse(JSON.parse(row.variableSnapshot))
          : null,
        allowedDomains: formAllowedDomainsCodec.decode(row.allowedDomains),
      }),
    );
  }

  public async createSignupForm(input: SignupFormWrite): Promise<{ id: string }> {
    const publication = await this.preparePublication(input);
    const id = uuidv7();
    const now = nowIso();
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(forms).values({
        id,
        workspaceId: this.context.workspaceId,
        name: input.name,
        slug: input.slug,
        status: input.status,
        definition: formDefinitionCodec.encode(publication.definition),
        sourceDefinition: formDefinitionCodec.encode(input.definition),
        sourceSuccessMessage: input.successMessage,
        variableProjectId: input.variableProjectId ?? null,
        variableSnapshot: publication.snapshot ? JSON.stringify(publication.snapshot) : null,
        allowedDomains: formAllowedDomainsCodec.encode(input.allowedDomains),
        turnstileEnabled: input.turnstileEnabled,
        successMessage: publication.successMessage,
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(formVersions).values({
        id: uuidv7(),
        workspaceId: this.context.workspaceId,
        formId: id,
        publishedAt: input.status === "published" ? now : null,
        version: 1,
        definition: formDefinitionCodec.encode(publication.definition),
        sourceDefinition: formDefinitionCodec.encode(input.definition),
        sourceSuccessMessage: input.successMessage,
        variableProjectId: input.variableProjectId ?? null,
        variableSnapshot: publication.snapshot ? JSON.stringify(publication.snapshot) : null,
        allowedDomains: formAllowedDomainsCodec.encode(input.allowedDomains),
        turnstileEnabled: input.turnstileEnabled,
        successMessage: publication.successMessage,
        createdAt: now,
      }),
    ]);
    return { id };
  }

  public async updateSignupForm(id: string, input: SignupFormWrite): Promise<boolean> {
    const publication = await this.preparePublication(input, id);
    const orm = this.database.orm;
    const [result] = await orm.batch([
      orm
        .update(forms)
        .set({
          name: input.name,
          slug: input.slug,
          status: input.status,
          version: sql`${forms.version} + 1`,
          definition: formDefinitionCodec.encode(publication.definition),
          sourceDefinition: formDefinitionCodec.encode(input.definition),
          sourceSuccessMessage: input.successMessage,
          variableProjectId: input.variableProjectId ?? null,
          variableSnapshot: publication.snapshot ? JSON.stringify(publication.snapshot) : null,
          allowedDomains: formAllowedDomainsCodec.encode(input.allowedDomains),
          turnstileEnabled: input.turnstileEnabled,
          successMessage: publication.successMessage,
          updatedAt: nowIso(),
        })
        .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived"))),
      orm.insert(formVersions).select(
        orm
          .select({
            id: sql<string>`${uuidv7()}`.as("snapshot_id"),
            workspaceId: forms.workspaceId,
            formId: forms.id,
            version: forms.version,
            definition: forms.definition,
            sourceDefinition: forms.sourceDefinition,
            sourceSuccessMessage: forms.sourceSuccessMessage,
            variableProjectId: forms.variableProjectId,
            variableSnapshot: forms.variableSnapshot,
            programBinding: sql<
              string | null
            >`${publication.programBinding ? JSON.stringify(publication.programBinding) : null}`.as(
              "program_binding",
            ),
            publishedAt: sql<string | null>`${input.status === "published" ? nowIso() : null}`.as(
              "published_at",
            ),
            allowedDomains: forms.allowedDomains,
            turnstileEnabled: forms.turnstileEnabled,
            successMessage: forms.successMessage,
            createdAt: forms.updatedAt,
          })
          .from(forms)
          .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived"))),
      ),
    ]);
    return changedExactlyOne(result);
  }

  private async preparePublication(input: SignupFormWrite, formId?: string) {
    const variables = new VariableRepository(this.database, this.context);
    await variables.assertProject(input.variableProjectId ?? null);
    if (input.status !== "published")
      return {
        definition: input.definition,
        successMessage: input.successMessage,
        snapshot: null,
        programBinding: null,
      };
    const snapshot = await variables.resolve(input.variableProjectId ?? null);
    const resolved = resolveFormVariables(input.definition, input.successMessage, snapshot);
    if (resolved.successMessage.length > 500)
      throw new VariableResolutionError("type", "Resolved form success message is too long");
    const programBinding = formId
      ? await new FormProgramRepository(this.database, this.context).get(formId)
      : null;
    return { ...resolved, snapshot, programBinding };
  }

  public async archiveSignupForm(id: string): Promise<boolean> {
    const result = await this.database.orm
      .update(forms)
      .set({ status: "archived", updatedAt: nowIso() })
      .where(and(this.inWorkspace(forms), eq(forms.id, id), ne(forms.status, "archived")));
    return changedExactlyOne(result);
  }
}
