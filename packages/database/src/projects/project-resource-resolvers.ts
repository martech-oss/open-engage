import { and, eq, isNull, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { PROJECT_RESOURCE_TYPES, type ProjectResourceType } from "@openengage/core/projects";

import { automations } from "../automations/schema";
import type { OpenEngageDatabase } from "../client";
import { emailTemplates } from "../messaging/schema";
import { segments } from "../segments/schema";
import { customRedirects, forms, landingPages } from "../web/schema";

export interface ResolvedProjectResource {
  name: string;
  status: string | null;
  availability: "available" | "archived" | "missing";
}

interface ResolvedResourceEntry {
  type: ProjectResourceType;
  id: string;
  resource: ResolvedProjectResource;
}

export interface ProjectResourceResolver {
  availableCondition(id: string): SQL;
  readAvailable(id: string): Promise<unknown>;
  resolve(ids: string[]): Promise<ResolvedResourceEntry[]>;
}

export function createProjectResourceResolverRegistry(
  database: OpenEngageDatabase,
  workspaceId: string,
) {
  const orm = database.orm;
  return {
    automation: {
      availableCondition: (id) =>
        sql`EXISTS (
          SELECT 1 FROM ${automations}
          WHERE ${automations.workspaceId} = ${workspaceId}
            AND ${automations.id} = ${id}
            AND ${automations.status} != 'archived'
        )`,
      readAvailable: (id) =>
        orm
          .select({ id: automations.id })
          .from(automations)
          .where(
            and(
              eq(automations.workspaceId, workspaceId),
              eq(automations.id, id),
              ne(automations.status, "archived"),
            ),
          )
          .get(),
      resolve: async (ids) => {
        if (ids.length === 0) return [];
        const rows = await orm
          .select({ id: automations.id, name: automations.name, status: automations.status })
          .from(automations)
          .where(and(eq(automations.workspaceId, workspaceId), inJsonIds(automations.id, ids)));
        return rows.map((row) => ({
          type: "automation" as const,
          id: row.id,
          resource: {
            name: row.name,
            status: row.status,
            availability:
              row.status === "archived" ? ("archived" as const) : ("available" as const),
          },
        }));
      },
    },
    email_sequence: {
      availableCondition: (id) =>
        sql`EXISTS (
          SELECT 1 FROM ${emailTemplates}
          WHERE ${emailTemplates.workspaceId} = ${workspaceId}
            AND ${emailTemplates.id} = ${id}
            AND ${emailTemplates.archivedAt} IS NULL
        )`,
      readAvailable: (id) =>
        orm
          .select({ id: emailTemplates.id })
          .from(emailTemplates)
          .where(
            and(
              eq(emailTemplates.workspaceId, workspaceId),
              eq(emailTemplates.id, id),
              isNull(emailTemplates.archivedAt),
            ),
          )
          .get(),
      resolve: async (ids) => {
        if (ids.length === 0) return [];
        const rows = await orm
          .select({
            id: emailTemplates.id,
            name: emailTemplates.name,
            archivedAt: emailTemplates.archivedAt,
            publishedAt: emailTemplates.publishedAt,
          })
          .from(emailTemplates)
          .where(
            and(eq(emailTemplates.workspaceId, workspaceId), inJsonIds(emailTemplates.id, ids)),
          );
        return rows.map((row) => ({
          type: "email_sequence" as const,
          id: row.id,
          resource: {
            name: row.name,
            status: row.archivedAt ? "archived" : row.publishedAt ? "published" : "draft",
            availability: row.archivedAt ? ("archived" as const) : ("available" as const),
          },
        }));
      },
    },
    segment: {
      availableCondition: (id) =>
        sql`EXISTS (
          SELECT 1 FROM ${segments}
          WHERE ${segments.workspaceId} = ${workspaceId} AND ${segments.id} = ${id}
        )`,
      readAvailable: (id) =>
        orm
          .select({ id: segments.id })
          .from(segments)
          .where(and(eq(segments.workspaceId, workspaceId), eq(segments.id, id)))
          .get(),
      resolve: async (ids) => {
        if (ids.length === 0) return [];
        const rows = await orm
          .select({ id: segments.id, name: segments.name, status: segments.evaluationStatus })
          .from(segments)
          .where(and(eq(segments.workspaceId, workspaceId), inJsonIds(segments.id, ids)));
        return rows.map((row) => ({
          type: "segment" as const,
          id: row.id,
          resource: { name: row.name, status: row.status, availability: "available" as const },
        }));
      },
    },
    form: {
      availableCondition: (id) =>
        sql`EXISTS (
          SELECT 1 FROM ${forms}
          WHERE ${forms.workspaceId} = ${workspaceId}
            AND ${forms.id} = ${id}
            AND ${forms.status} != 'archived'
        )`,
      readAvailable: (id) =>
        orm
          .select({ id: forms.id })
          .from(forms)
          .where(
            and(eq(forms.workspaceId, workspaceId), eq(forms.id, id), ne(forms.status, "archived")),
          )
          .get(),
      resolve: async (ids) => {
        if (ids.length === 0) return [];
        const rows = await orm
          .select({ id: forms.id, name: forms.name, status: forms.status })
          .from(forms)
          .where(and(eq(forms.workspaceId, workspaceId), inJsonIds(forms.id, ids)));
        return rows.map((row) => ({
          type: "form" as const,
          id: row.id,
          resource: {
            name: row.name,
            status: row.status,
            availability:
              row.status === "archived" ? ("archived" as const) : ("available" as const),
          },
        }));
      },
    },
    landing_page: {
      availableCondition: (id) =>
        sql`EXISTS (
          SELECT 1 FROM ${landingPages}
          WHERE ${landingPages.workspaceId} = ${workspaceId}
            AND ${landingPages.id} = ${id}
            AND ${landingPages.status} != 'archived'
        )`,
      readAvailable: (id) =>
        orm
          .select({ id: landingPages.id })
          .from(landingPages)
          .where(
            and(
              eq(landingPages.workspaceId, workspaceId),
              eq(landingPages.id, id),
              ne(landingPages.status, "archived"),
            ),
          )
          .get(),
      resolve: async (ids) => {
        if (ids.length === 0) return [];
        const rows = await orm
          .select({ id: landingPages.id, name: landingPages.name, status: landingPages.status })
          .from(landingPages)
          .where(and(eq(landingPages.workspaceId, workspaceId), inJsonIds(landingPages.id, ids)));
        return rows.map((row) => ({
          type: "landing_page" as const,
          id: row.id,
          resource: {
            name: row.name,
            status: row.status,
            availability:
              row.status === "archived" ? ("archived" as const) : ("available" as const),
          },
        }));
      },
    },
    redirect: {
      availableCondition: (id) =>
        sql`EXISTS (
          SELECT 1 FROM ${customRedirects}
          WHERE ${customRedirects.workspaceId} = ${workspaceId}
            AND ${customRedirects.id} = ${id}
            AND ${customRedirects.archivedAt} IS NULL
        )`,
      readAvailable: (id) =>
        orm
          .select({ id: customRedirects.id })
          .from(customRedirects)
          .where(
            and(
              eq(customRedirects.workspaceId, workspaceId),
              eq(customRedirects.id, id),
              isNull(customRedirects.archivedAt),
            ),
          )
          .get(),
      resolve: async (ids) => {
        if (ids.length === 0) return [];
        const rows = await orm
          .select({
            id: customRedirects.id,
            name: customRedirects.name,
            archivedAt: customRedirects.archivedAt,
          })
          .from(customRedirects)
          .where(
            and(eq(customRedirects.workspaceId, workspaceId), inJsonIds(customRedirects.id, ids)),
          );
        return rows.map((row) => ({
          type: "redirect" as const,
          id: row.id,
          resource: {
            name: row.name,
            status: row.archivedAt ? "archived" : "active",
            availability: row.archivedAt ? ("archived" as const) : ("available" as const),
          },
        }));
      },
    },
  } satisfies Record<ProjectResourceType, ProjectResourceResolver>;
}

export async function resolveProjectResources(
  registry: ReturnType<typeof createProjectResourceResolverRegistry>,
  rows: Array<{ resourceType: string; resourceId: string }>,
): Promise<Map<string, ResolvedProjectResource>> {
  const batches = await Promise.all(
    PROJECT_RESOURCE_TYPES.map((type) =>
      registry[type].resolve(
        rows.filter((row) => row.resourceType === type).map((row) => row.resourceId),
      ),
    ),
  );
  return new Map(
    batches.flat().map((item) => [projectResourceKey(item.type, item.id), item.resource]),
  );
}

export function projectResourceKey(type: string, id: string): string {
  return `${type}:${id}`;
}

/** D1 caps bound parameters at 100; JSON1 keeps each resource-type lookup to one bind. */
function inJsonIds(column: SQLWrapper, ids: string[]): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`;
}
