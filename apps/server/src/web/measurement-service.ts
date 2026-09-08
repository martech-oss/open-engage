import * as z from "zod";

import type { OpenEngageDatabase } from "@openengage/database/client";
import { LandingDesignRepository, PublicLandingRepository } from "@openengage/database/web";

import type { RuntimeEnv } from "../env";
import { createSignedToken, verifySignedToken } from "../platform/crypto";

const metadataSchema = z.object({
  pageId: z.string(),
  visitorId: z.string().nullable(),
  source: z.record(z.string(), z.string()).default({}),
  experimentId: z.string().optional(),
  variantId: z.string().optional(),
  exposureId: z.string().optional(),
});
export type MeasurementMetadata = z.infer<typeof metadataSchema>;

export function measurementSource(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const source: Record<string, string> = {};
  for (const key of ["url", "referrer"] as const) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const url = URL.parse(value);
    if (!url || !["http:", "https:"].includes(url.protocol)) continue;
    source[key] = `${url.origin}${url.pathname}`.slice(0, 2000);
    if (key === "url")
      for (const parameter of [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
      ]) {
        const term = url.searchParams.get(parameter);
        if (term) source[parameter] = term.slice(0, 500);
      }
  }
  return source;
}

export async function issueMeasurementToken(
  env: RuntimeEnv,
  workspaceId: string,
  pageVersionId: string,
  metadata: MeasurementMetadata,
): Promise<string> {
  return createSignedToken(env.TRACKING_SIGNING_SECRET, {
    workspaceId,
    resourceId: pageVersionId,
    purpose: "page_context",
    expiresAt: Date.now() + 31 * 24 * 60 * 60_000,
    url: JSON.stringify(metadata),
  });
}

export async function verifyMeasurementContext(
  database: OpenEngageDatabase,
  env: RuntimeEnv,
  token: unknown,
  options: { workspaceId?: string; visitorId?: string | null; formId?: string } = {},
) {
  if (typeof token !== "string" || token.length > 12_000) return null;
  const signed = await verifySignedToken(env.TRACKING_SIGNING_SECRET, token, "page_context");
  if (!signed || (options.workspaceId && options.workspaceId !== signed.workspaceId)) return null;
  let parsed;
  try {
    parsed = metadataSchema.safeParse(JSON.parse(signed.url ?? ""));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const metadata = parsed.data;
  if (options.visitorId && metadata.visitorId && metadata.visitorId !== options.visitorId)
    return null;
  const repository = new LandingDesignRepository(database, { workspaceId: signed.workspaceId });
  const page = await repository.page(metadata.pageId),
    version = await repository.version(metadata.pageId, signed.resourceId);
  if (!page || !version?.publishedAt) return null;
  const binding = options.formId
    ? version.formBindings.find((item) => item.formId === options.formId)
    : undefined;
  if (options.formId && !binding) return null;
  const form = binding
    ? await new PublicLandingRepository(database).pinnedForm(
        signed.workspaceId,
        binding.formVersionId,
      )
    : null;
  if (binding && !form) return null;
  return {
    workspaceId: signed.workspaceId,
    visitorId: metadata.visitorId,
    document: version.document,
    form,
    properties: {
      pageId: metadata.pageId,
      pageVersionId: version.id,
      projectId: version.document.measurement.projectId,
      source: metadata.source,
      ...(binding ? { formId: binding.formId, formVersionId: binding.formVersionId } : {}),
      ...(metadata.experimentId
        ? {
            experimentId: metadata.experimentId,
            variantId: metadata.variantId,
            exposureId: metadata.exposureId,
          }
        : {}),
    },
  };
}

/** Untrusted integrations may send custom properties but cannot impersonate managed resources. */
export function stripReservedMeasurementProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const reserved = new Set([
    "workspaceId",
    "pageId",
    "pageVersionId",
    "publishedVersionId",
    "formId",
    "formVersionId",
    "projectId",
    "campaignId",
    "experimentId",
    "variantId",
    "exposureId",
    "measurement",
    "source",
  ]);
  return Object.fromEntries(Object.entries(properties).filter(([key]) => !reserved.has(key)));
}
