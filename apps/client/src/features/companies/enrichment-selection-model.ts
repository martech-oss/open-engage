import type { CompanyEnrichmentProposal } from "@openengage/core/contacts";

export interface CompanyEnrichmentApplySelection {
  name: boolean;
  domain: boolean;
}

export function defaultCompanyEnrichmentApplySelection(
  currentName: string,
  currentDomain: string,
  proposal: CompanyEnrichmentProposal,
): CompanyEnrichmentApplySelection {
  const proposedName = proposal.fields.officialName?.value;
  const proposedDomain = proposal.fields.domain?.value;
  return {
    name: Boolean(proposedName) && (!currentName || proposedName === currentName),
    domain: Boolean(proposedDomain) && (!currentDomain || proposedDomain === currentDomain),
  };
}

export function selectedCompanyEnrichmentValues(
  proposal: CompanyEnrichmentProposal,
  selection: CompanyEnrichmentApplySelection,
): { name?: string; domain?: string } {
  const name = proposal.fields.officialName?.value;
  const domain = proposal.fields.domain?.value;
  return {
    ...(selection.name && name ? { name } : {}),
    ...(selection.domain && domain ? { domain } : {}),
  };
}
