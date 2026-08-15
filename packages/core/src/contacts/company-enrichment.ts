import * as z from "zod";

import { companyDomainSchema } from "./company-dto.js";

export const companyEnrichmentFieldNameSchema = z.enum([
  "officialName",
  "domain",
  "description",
  "industries",
  "productsServices",
  "headquarters",
  "phone",
  "foundedYear",
  "employeeRange",
  "socialUrls",
  "logoUrl",
]);
export type CompanyEnrichmentFieldName = z.infer<typeof companyEnrichmentFieldNameSchema>;

export const companyEnrichmentInputSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("company"), companyId: z.string().min(1) }),
  z.object({ source: z.literal("domain"), domain: companyDomainSchema }),
  z.object({ source: z.literal("name"), name: z.string().trim().min(1).max(191) }),
]);
export type CompanyEnrichmentInput = z.infer<typeof companyEnrichmentInputSchema>;

export const companyEnrichmentAgentRequestSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("domain"), domain: companyDomainSchema }),
  z.object({ source: z.literal("name"), name: z.string().trim().min(1).max(191) }),
]);
export type CompanyEnrichmentAgentRequest = z.infer<typeof companyEnrichmentAgentRequestSchema>;

export const companyEnrichmentAgentInitialDataSchema = z.object({
  request: companyEnrichmentAgentRequestSchema,
});
export type CompanyEnrichmentAgentInitialData = z.infer<
  typeof companyEnrichmentAgentInitialDataSchema
>;

export const companyEnrichmentCapabilitySchema = z.object({ enabled: z.boolean() });
export type CompanyEnrichmentCapability = z.infer<typeof companyEnrichmentCapabilitySchema>;

const confidenceSchema = z.enum(["high", "medium", "low"]);
export type CompanyEnrichmentConfidence = z.infer<typeof confidenceSchema>;

const sourceIdsSchema = z.array(z.string().trim().min(1).max(64)).min(1).max(12);
const sourcedField = <T extends z.ZodType>(value: T) =>
  z.object({ value, confidence: confidenceSchema, sourceIds: sourceIdsSchema });

export const companyEnrichmentSocialUrlSchema = z.object({
  network: z.string().trim().min(1).max(50),
  url: z.url().max(2_048),
});

export const companyEnrichmentFieldsSchema = z
  .object({
    officialName: sourcedField(z.string().trim().min(1).max(191)),
    domain: sourcedField(companyDomainSchema),
    description: sourcedField(z.string().trim().min(1).max(2_000)),
    industries: sourcedField(z.array(z.string().trim().min(1).max(100)).min(1).max(20)),
    productsServices: sourcedField(z.array(z.string().trim().min(1).max(191)).min(1).max(30)),
    headquarters: sourcedField(z.string().trim().min(1).max(500)),
    phone: sourcedField(z.string().trim().min(1).max(100)),
    foundedYear: sourcedField(z.number().int().min(1600).max(3000)),
    employeeRange: sourcedField(z.string().trim().min(1).max(100)),
    socialUrls: sourcedField(z.array(companyEnrichmentSocialUrlSchema).min(1).max(20)),
    logoUrl: sourcedField(z.url().max(2_048)),
  })
  .partial();
export type CompanyEnrichmentFields = z.infer<typeof companyEnrichmentFieldsSchema>;

export const companyEnrichmentSourceSchema = z.object({
  id: z.string().trim().min(1).max(64),
  url: z.url().max(2_048),
  title: z.string().trim().min(1).max(500),
  kind: z.enum(["official", "search"]),
  retrievedAt: z.iso.datetime(),
});
export type CompanyEnrichmentSource = z.infer<typeof companyEnrichmentSourceSchema>;

export const companyEnrichmentWarningSchema = z.object({
  code: z.string().trim().min(1).max(64),
  message: z.string().trim().min(1).max(1_000),
  field: companyEnrichmentFieldNameSchema.optional(),
});
export type CompanyEnrichmentWarning = z.infer<typeof companyEnrichmentWarningSchema>;

export const companyEnrichmentCandidateSchema = z.object({
  name: z.string().trim().min(1).max(191),
  domain: companyDomainSchema,
  url: z.url().max(2_048),
  reason: z.string().trim().min(1).max(1_000),
  sourceIds: sourceIdsSchema,
});
export type CompanyEnrichmentCandidate = z.infer<typeof companyEnrichmentCandidateSchema>;

const needsDomainSchema = z.object({
  status: z.literal("needs_domain"),
  candidates: z.array(companyEnrichmentCandidateSchema).max(5),
  reason: z.string().trim().min(1).max(1_000),
  sources: z.array(companyEnrichmentSourceSchema).max(30),
});

export const companyEnrichmentProposalSchema = z.object({
  fields: companyEnrichmentFieldsSchema,
  sources: z.array(companyEnrichmentSourceSchema).min(1).max(30),
  warnings: z.array(companyEnrichmentWarningSchema).max(30),
});
export type CompanyEnrichmentProposal = z.infer<typeof companyEnrichmentProposalSchema>;

const readySchema = z.object({
  status: z.literal("ready"),
  proposal: companyEnrichmentProposalSchema,
});

export const companyEnrichmentResultSchema = z.discriminatedUnion("status", [
  needsDomainSchema,
  readySchema,
]);
export type CompanyEnrichmentResult = z.infer<typeof companyEnrichmentResultSchema>;

/** Ensures every proposed value and candidate points to an actual unique source. */
export function validateCompanyEnrichmentResult(result: CompanyEnrichmentResult): string | null {
  const sources = result.status === "ready" ? result.proposal.sources : result.sources;
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) return `Duplicate enrichment source id: ${source.id}`;
    sourceIds.add(source.id);
    if (!isPublicHttpsUrl(source.url)) return `Source URL must be public HTTPS: ${source.url}`;
  }

  const references =
    result.status === "ready"
      ? Object.values(result.proposal.fields).flatMap((field) => field?.sourceIds ?? [])
      : result.candidates.flatMap((candidate) => candidate.sourceIds);
  const missing = references.find((id) => !sourceIds.has(id));
  if (missing) return `Unknown enrichment source id: ${missing}`;

  if (result.status === "needs_domain") {
    const unsafeCandidate = result.candidates.find(
      (candidate) =>
        !isPublicHttpsUrl(candidate.url) || new URL(candidate.url).hostname !== candidate.domain,
    );
    if (unsafeCandidate)
      return `Candidate URL must be HTTPS and match its domain: ${unsafeCandidate.url}`;
  }
  return null;
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }
    if (hostname.includes(":")) {
      return !(
        hostname === "::" ||
        hostname === "::1" ||
        hostname.startsWith("fc") ||
        hostname.startsWith("fd") ||
        /^fe[89ab]/.test(hostname)
      );
    }
    const parts = hostname.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return true;
    const octets = parts.map(Number);
    const [a = 0, b = 0] = octets;
    return !(
      octets.some((part) => part < 0 || part > 255) ||
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  } catch {
    return false;
  }
}
