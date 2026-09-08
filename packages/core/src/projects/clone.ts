import * as z from "zod";

import { rewriteCloneMarkdown } from "./clone-markdown";

export const projectCloneOptionsSchema = z
  .object({
    name: z.string().trim().min(1).max(191),
    ownerUserId: z.string().min(1).nullable().default(null),
    approverUserId: z.string().min(1).nullable().default(null),
    reviewAt: z.iso.datetime().nullable().default(null),
    variables: z
      .record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()]))
      .default({}),
  })
  .refine((value) => !value.ownerUserId || value.ownerUserId !== value.approverUserId, {
    path: ["approverUserId"],
    message: "担当者と承認者には異なるメンバーを指定してください",
  });
export type ProjectCloneOptions = z.infer<typeof projectCloneOptionsSchema>;

export const projectCloneResourceSchema = z.object({
  kind: z.enum([
    "project",
    "brief",
    "program",
    "variable",
    "automation",
    "automation_version",
    "form",
    "form_version",
    "form_binding",
    "landing_page",
    "landing_page_version",
    "experiment",
    "dynamic_content",
    "segment",
    "redirect",
    "email_sequence",
  ]),
  sourceId: z.string(),
  targetId: z.string(),
  name: z.string(),
  sourceVersion: z.string().nullable(),
  sourceSlug: z.string().nullable(),
  targetSlug: z.string().nullable(),
  linked: z.boolean(),
});
export type ProjectCloneResource = z.infer<typeof projectCloneResourceSchema>;
export type ProjectCloneResourceKind = ProjectCloneResource["kind"];

export const projectClonePreviewSchema = z.object({
  id: z.string(),
  sourceProjectId: z.string(),
  targetProjectId: z.string(),
  options: projectCloneOptionsSchema,
  resources: z.array(projectCloneResourceSchema),
  sharedReferences: z.array(
    z.object({ kind: z.string(), id: z.string(), name: z.string(), slug: z.string().optional() }),
  ),
  createdAt: z.string(),
});
export type ProjectClonePreview = z.infer<typeof projectClonePreviewSchema>;
export const projectCloneJobSchema = projectClonePreviewSchema.extend({
  status: z.enum(["preview", "queued", "running", "completed", "failed"]),
  preparedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type ProjectCloneJob = z.infer<typeof projectCloneJobSchema>;

export interface ProjectCloneReferenceMap {
  ids: Record<string, string>;
  segmentSlugs: Record<string, string>;
  /** Only exact URLs proven to belong to a managed resource on our origin. */
  managedUrls: Record<string, string>;
}

const referenceKeys = new Set([
  "projectId",
  "variableProjectId",
  "variableContextProjectId",
  "contextProjectId",
  "acquisitionProjectId",
  "formId",
  "pageId",
  "pageVersionId",
  "formVersionId",
  "automationId",
  "automationVersionId",
  "segmentId",
  "templateId",
  "redirectId",
  "resourceId",
]);
const urlKeys = new Set(["href", "url", "ctaUrl", "destinationUrl", "successUrl", "failureUrl"]);

function rewriteManagedUrl(value: string, map: Record<string, string>): string {
  try {
    const url = new URL(value);
    const replacement = map[`${url.origin}${url.pathname}`];
    return replacement ? `${replacement}${url.search}${url.hash}` : value;
  } catch {
    return value;
  }
}

/** Rewrites typed resource references, never arbitrary display strings or variable values. */
export function rewriteProjectCloneReferences(
  value: unknown,
  map: ProjectCloneReferenceMap,
): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteProjectCloneReferences(item, map));
  if (value === null || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(input).map(([key, item]) => {
      if (
        key === "program" &&
        input.kind === "condition" &&
        input.field === "project_status" &&
        item &&
        typeof item === "object"
      ) {
        const program = item as Record<string, unknown>;
        if (typeof program.projectId === "string" && Object.hasOwn(map.ids, program.projectId))
          return [key, { ...program, projectId: map.ids[program.projectId], definitionVersion: 1 }];
      }
      if (typeof item === "string" && referenceKeys.has(key)) return [key, map.ids[item] ?? item];
      if (key === "value" && input.kind === "condition" && input.field === "segment") {
        const remap = (slug: unknown) =>
          typeof slug === "string" ? (map.segmentSlugs[slug] ?? slug) : slug;
        return [key, Array.isArray(item) ? item.map(remap) : remap(item)];
      }
      if (
        key === "value" &&
        input.kind === "condition" &&
        ["project_id", "event_resource_id"].includes(String(input.field))
      ) {
        const remap = (id: unknown) => (typeof id === "string" ? (map.ids[id] ?? id) : id);
        return [key, Array.isArray(item) ? item.map(remap) : remap(item)];
      }
      if (typeof item === "string" && urlKeys.has(key))
        return [key, rewriteManagedUrl(item, map.managedUrls)];
      if (typeof item === "string" && key === "markdown")
        return [key, rewriteCloneMarkdown(item, (url) => rewriteManagedUrl(url, map.managedUrls))];
      if (typeof item === "string" && ["html", "fallbackHtml"].includes(key)) {
        return [
          key,
          item.replace(
            /\b(href|action)=("|')([^"']+)\2/gi,
            (_match, attr: string, quote: string, url: string) =>
              `${attr}=${quote}${rewriteManagedUrl(url, map.managedUrls)}${quote}`,
          ),
        ];
      }
      return [key, rewriteProjectCloneReferences(item, map)];
    }),
  );
}
