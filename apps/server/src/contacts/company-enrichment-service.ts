import {
  companyEnrichmentResultSchema,
  validateCompanyEnrichmentResult,
  type CompanyEnrichmentAgentRequest,
  type CompanyEnrichmentResult,
} from "@openengage/core/contacts";

import { AgentProposalError, requestAgentProposal } from "../agents/proposal-client";
import type { RuntimeEnv } from "../env";

const ENRICHMENT_TIMEOUT_MS = 90_000;

export type CompanyEnrichmentFailure = "failed" | "timeout" | "unavailable";

export class CompanyEnrichmentError extends Error {
  public constructor(
    public readonly kind: CompanyEnrichmentFailure,
    options?: ErrorOptions,
  ) {
    super(`Company enrichment ${kind}`, options);
    this.name = "CompanyEnrichmentError";
  }
}

export function isCompanyEnrichmentEnabled(env: { COMPANY_ENRICHMENT_ENABLED: string }): boolean {
  return String(env.COMPANY_ENRICHMENT_ENABLED).trim().toLowerCase() === "true";
}

export async function enrichCompany(
  env: RuntimeEnv,
  request: CompanyEnrichmentAgentRequest,
): Promise<CompanyEnrichmentResult> {
  if (!isCompanyEnrichmentEnabled(env)) throw new CompanyEnrichmentError("unavailable");
  try {
    const result = await requestAgentProposal({
      env,
      agent: "company-enrichment",
      prompt: "Research this company and submit a source-backed enrichment proposal.",
      initialData: { request },
      schema: companyEnrichmentResultSchema,
      timeoutMs: ENRICHMENT_TIMEOUT_MS,
    });
    const validationIssue = validateCompanyEnrichmentResult(result);
    if (validationIssue) {
      throw new CompanyEnrichmentError("failed", { cause: new Error(validationIssue) });
    }
    return result;
  } catch (error) {
    if (error instanceof CompanyEnrichmentError) throw error;
    if (error instanceof AgentProposalError) {
      throw new CompanyEnrichmentError(error.kind, { cause: error });
    }
    throw error;
  }
}
