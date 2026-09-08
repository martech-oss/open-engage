import { and, eq } from "drizzle-orm";

import { programBindingSchema } from "@openengage/core/projects";
import type { LandingPageDocument } from "@openengage/core/web";

import { organization } from "../auth/schema";
import { DatabaseRepository } from "../shared/repository-base";
import { forms, formVersions, landingPages } from "./schema";

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
      programBinding: row.programBinding
        ? programBindingSchema.parse(JSON.parse(row.programBinding))
        : null,
      workspaceId,
      name: form.name,
      definition: JSON.parse(row.definition) as LandingPageDocument["forms"][number]["definition"],
      allowedDomains: JSON.parse(row.allowedDomains) as string[],
      turnstileEnabled: row.turnstileEnabled,
      successMessage: row.successMessage,
    };
  }
}
