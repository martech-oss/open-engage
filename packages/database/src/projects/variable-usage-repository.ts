import { and, eq, isNotNull, ne, or } from "drizzle-orm";

import {
  automationDefinitionSchema,
  automationVariableReferences,
} from "@openengage/core/automations";
import { variableSnapshotSchema, type VariableUsage } from "@openengage/core/projects";
import {
  formVariableReferences,
  landingFormBindingSchema,
  landingPageDocumentSchema,
  landingVariableReferences,
  signupFormDefinitionSchema,
} from "@openengage/core/web";

import { automations, automationVersions } from "../automations/schema";
import { WorkspaceRepository } from "../shared/repository-base";
import { forms, formVersions, landingPages, landingPageVersions } from "../web/schema";
import { VariableCallUsageRepository } from "./variable-call-usage-repository";
import { inspectUsage } from "./variable-usage-analysis";
const snapshot = (value: string | null) =>
  value ? variableSnapshotSchema.parse(JSON.parse(value)) : null;
export class VariableUsageRepository extends WorkspaceRepository {
  async list(): Promise<VariableUsage[]> {
    const [pages, formRows, automationRows] = await Promise.all([
      this.database.orm
        .select({
          resourceId: landingPages.id,
          name: landingPages.name,
          versionId: landingPageVersions.id,
          document: landingPageVersions.document,
          publishedAt: landingPageVersions.publishedAt,
          snapshot: landingPageVersions.variableSnapshot,
          formBindings: landingPageVersions.formBindings,
        })
        .from(landingPages)
        .innerJoin(
          landingPageVersions,
          and(
            eq(landingPages.workspaceId, landingPageVersions.workspaceId),
            eq(landingPages.id, landingPageVersions.pageId),
          ),
        )
        .where(
          and(
            this.inWorkspace(landingPages),
            ne(landingPages.status, "archived"),
            or(
              eq(landingPageVersions.id, landingPages.currentVersionId),
              isNotNull(landingPageVersions.publishedAt),
            ),
          ),
        ),
      this.database.orm
        .select({
          resourceId: forms.id,
          name: forms.name,
          projectId: formVersions.variableProjectId,
          versionId: formVersions.id,
          definition: formVersions.definition,
          sourceDefinition: formVersions.sourceDefinition,
          successMessage: formVersions.successMessage,
          sourceSuccessMessage: formVersions.sourceSuccessMessage,
          snapshot: formVersions.variableSnapshot,
          publishedAt: formVersions.publishedAt,
        })
        .from(forms)
        .innerJoin(
          formVersions,
          and(eq(forms.workspaceId, formVersions.workspaceId), eq(forms.id, formVersions.formId)),
        )
        .where(
          and(
            this.inWorkspace(forms),
            ne(forms.status, "archived"),
            or(eq(formVersions.version, forms.version), isNotNull(formVersions.publishedAt)),
          ),
        ),
      this.database.orm
        .select({
          resourceId: automations.id,
          name: automations.name,
          versionId: automationVersions.id,
          graph: automationVersions.graph,
          publishedAt: automationVersions.publishedAt,
          snapshot: automationVersions.variableSnapshot,
          dependencies: automationVersions.dependencies,
        })
        .from(automations)
        .innerJoin(
          automationVersions,
          and(
            eq(automations.workspaceId, automationVersions.workspaceId),
            eq(automations.id, automationVersions.automationId),
          ),
        )
        .where(
          and(
            this.inWorkspace(automations),
            ne(automations.status, "archived"),
            or(
              eq(automationVersions.id, automations.draftVersionId),
              isNotNull(automationVersions.publishedAt),
            ),
          ),
        ),
    ]);
    const uses: VariableUsage[] = [];
    for (const row of pages) {
      if (!row.document) continue;
      const document = landingPageDocumentSchema.parse(JSON.parse(row.document));
      const page: VariableUsage = {
        resourceType: "landing_page" as const,
        resourceId: row.resourceId,
        name: row.name,
        projectId: document.variableProjectId ?? null,
        versionId: row.versionId,
        published: Boolean(row.publishedAt),
        ...inspectUsage((text) => landingVariableReferences(document, text)),
        snapshot: snapshot(row.snapshot),
        dependencyPath: [],
      };
      uses.push(page);
      const bindings = landingFormBindingSchema.array().parse(JSON.parse(row.formBindings));
      for (const form of document.forms.filter((form) => form.formId)) {
        const binding = bindings.find((binding) => binding.refId === form.refId);
        const context = page.published
          ? binding &&
            (await this.database.orm
              .select({
                projectId: formVersions.variableProjectId,
                snapshot: formVersions.variableSnapshot,
              })
              .from(formVersions)
              .where(
                and(this.inWorkspace(formVersions), eq(formVersions.id, binding.formVersionId)),
              )
              .get())
          : await this.database.orm
              .select({ projectId: forms.variableProjectId })
              .from(forms)
              .where(
                and(
                  this.inWorkspace(forms),
                  eq(forms.id, form.formId!),
                  ne(forms.status, "archived"),
                ),
              )
              .get();
        const analysis = inspectUsage((text) => [
          ...text(form.name),
          ...formVariableReferences(form.definition, form.successMessage, text),
        ]);
        uses.push({
          ...page,
          ...analysis,
          dependencyPath: [`form:${form.refId}`],
          projectId: context?.projectId ?? null,
          snapshot:
            context && "snapshot" in context && typeof context.snapshot === "string"
              ? snapshot(context.snapshot)
              : null,
          diagnostics: context
            ? analysis.diagnostics
            : [...analysis.diagnostics, "Shared form context unavailable"],
        });
      }
    }
    for (const row of formRows)
      uses.push({
        resourceType: "form" as const,
        resourceId: row.resourceId,
        name: row.name,
        projectId: row.projectId,
        versionId: row.versionId,
        published: Boolean(row.publishedAt),
        ...inspectUsage((text) =>
          formVariableReferences(
            signupFormDefinitionSchema.parse(JSON.parse(row.sourceDefinition ?? row.definition)),
            row.sourceSuccessMessage ?? row.successMessage,
            text,
          ),
        ),
        snapshot: snapshot(row.snapshot),
        dependencyPath: [],
      });
    const calls = new VariableCallUsageRepository(this.database, this.context);
    for (const row of automationRows) {
      const graph = automationDefinitionSchema.parse(JSON.parse(row.graph));
      const automation: VariableUsage = {
        resourceType: "automation" as const,
        resourceId: row.resourceId,
        name: row.name,
        projectId: graph.variableProjectId ?? null,
        versionId: row.versionId,
        published: Boolean(row.publishedAt),
        ...inspectUsage((text) => automationVariableReferences(graph, text)),
        snapshot: snapshot(row.snapshot),
        dependencyPath: [],
      };
      uses.push(automation, ...(await calls.list(automation, graph, row.dependencies)));
    }
    return uses.filter((row) => row.references.length > 0 || row.diagnostics.length > 0);
  }
}
