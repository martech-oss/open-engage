import { companyEnrichmentAgent } from "@openengage/core/agents";
import {
  validateCompanyEnrichmentResult,
  type CompanyEnrichmentAgentRequest,
  type CompanyEnrichmentResult,
} from "@openengage/core/contacts";

import { AiGenerationError } from "../agents/generation-error";
import { requestAgentProposal } from "../agents/proposal-client";
import type { RuntimeEnv } from "../env";

export function isCompanyEnrichmentEnabled(env: { COMPANY_ENRICHMENT_ENABLED: string }): boolean {
  return String(env.COMPANY_ENRICHMENT_ENABLED).trim().toLowerCase() === "true";
}

export async function enrichCompany(
  env: RuntimeEnv,
  request: CompanyEnrichmentAgentRequest,
): Promise<CompanyEnrichmentResult> {
  if (!isCompanyEnrichmentEnabled(env)) throw new AiGenerationError("unavailable");
  const result = await requestAgentProposal({
    env,
    agent: companyEnrichmentAgent,
    prompt: "Research this company and submit a source-backed enrichment proposal.",
    initialData: { request },
  });
  const validationIssue = validateCompanyEnrichmentResult(result);
  if (validationIssue) {
    throw new AiGenerationError("failed", { cause: new Error(validationIssue) });
  }
  return result;
}
