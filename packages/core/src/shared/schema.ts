import * as z from "zod";

export const jsonRecordSchema = z.record(z.string(), z.unknown());
export type JsonRecord = z.infer<typeof jsonRecordSchema>;

export const stringArraySchema = z.array(z.string());

export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") return `${result}[${segment}]`;
    const key = String(segment);
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
      ? `${result}.${key}`
      : `${result}[${JSON.stringify(key)}]`;
  }, "$");
}

/**
 * The raw arrays behind each schema below are exported too, so
 * `@openengage/database`'s schema files can build their matching CHECK
 * constraint from the exact same source (via `checkEnum`) instead of
 * hand-duplicating the value list - the "role" enum alone used to be
 * hand-written in four different places.
 */

export const WORKSPACE_ROLES = ["owner", "admin", "marketer", "analyst", "viewer"] as const;
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

/** The first role is the most privileged; this is the one canonical role ordering. */
export function hasWorkspaceRole(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return WORKSPACE_ROLES.indexOf(role) <= WORKSPACE_ROLES.indexOf(minimum);
}

export function normalizeSlug(
  value: string,
  options: { fallback: string; maxLength?: number },
): string {
  const maxLength = Math.max(1, Math.floor(options.maxLength ?? 80));
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  if (normalized) return normalized;
  const fallback = options.fallback
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return fallback || "resource".slice(0, maxLength);
}

export const MESSAGE_PURPOSES = ["transactional", "marketing"] as const;
const messagePurposeSchema = z.enum(MESSAGE_PURPOSES);
export type MessagePurpose = z.infer<typeof messagePurposeSchema>;

export const CHANNELS = ["email", "webhook"] as const;
const channelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof channelSchema>;

export const PROVIDERS = ["cloudflare", "webhook"] as const;
const providerSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof providerSchema>;

/** Coarse facet derived from an asset's content type - drives the library filter tabs. */
export const ASSET_KINDS = ["image", "document", "video", "audio", "other"] as const;
export const assetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const ASSET_VISIBILITIES = ["public", "private"] as const;
export const assetVisibilitySchema = z.enum(ASSET_VISIBILITIES);
export type AssetVisibility = z.infer<typeof assetVisibilitySchema>;

/**
 * Buffered uploads hash with SHA-256; streamed uploads cannot (WebCrypto has no
 * incremental digest), so they record R2's own MD5 instead. The column says which.
 */
export const ASSET_CHECKSUM_ALGORITHMS = ["sha256", "md5"] as const;
export const assetChecksumAlgorithmSchema = z.enum(ASSET_CHECKSUM_ALGORITHMS);
export type AssetChecksumAlgorithm = z.infer<typeof assetChecksumAlgorithmSchema>;

export const DELIVERY_EVENT_TYPES = [
  "accepted",
  "delivered",
  "deferred",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "unsubscribed",
  "replied",
  "failed",
  "rejected",
] as const;
const deliveryEventTypeSchema = z.enum(DELIVERY_EVENT_TYPES);
export type DeliveryEventType = z.infer<typeof deliveryEventTypeSchema>;

export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  apiKeyId?: string;
}

export interface DeliveryEvent {
  id: string;
  workspaceId: string;
  deliveryId: string;
  provider: "cloudflare" | "webhook";
  providerMessageId?: string;
  type: DeliveryEventType;
  occurredAt: string;
  metadata: Record<string, unknown>;
}
