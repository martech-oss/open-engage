import { type QueryClient, useMutation } from "@tanstack/react-query";

import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { orpc, orpcQuery } from "@/lib/orpc";
import type { CompanyContactDto, CompanySummary } from "@openengage/core/contacts";

export type { CompanyContactDto, CompanySummary };

export interface CompanySearch {
  q: string;
}

export const companySearchDefaults: CompanySearch = { q: "" };

export function parseCompanySearch(search: Record<string, unknown>): CompanySearch {
  return {
    q: typeof search.q === "string" ? search.q : "",
  };
}

export function companiesQueryOptions(query = "") {
  return orpcQuery.companies.list.queryOptions({
    input: { limit: 200, ...(query.trim() ? { query: query.trim() } : {}) },
  });
}

export function companyQueryOptions(companyId: string) {
  return orpcQuery.companies.get.queryOptions({ input: { id: companyId } });
}

export function companyEnrichmentCapabilityQueryOptions() {
  return orpcQuery.companies.enrichmentCapability.queryOptions();
}

export function assignCompanyContact(input: {
  companyId: string;
  contactId: string;
  isPrimary: boolean;
}) {
  return orpc.companies.assignContact({
    id: input.companyId,
    contactId: input.contactId,
    isPrimary: input.isPrimary,
  });
}

export function removeCompanyContact(companyId: string, contactId: string) {
  return orpc.companies.removeContact({ id: companyId, contactId });
}

export function invalidateCompanyQueries(
  queryClient: QueryClient,
  companyId: string,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpcQuery.companies.get.key({ input: { id: companyId } }),
    }),
    queryClient.invalidateQueries({ queryKey: orpcQuery.companies.list.key() }),
  ]).then(() => undefined);
}

export function useCreateCompany() {
  return useInvalidatingMutation(orpcQuery.companies.create.mutationOptions(), [
    orpcQuery.companies.list.key(),
  ]);
}

export function useUpdateCompany() {
  return useInvalidatingMutation(
    orpcQuery.companies.update.mutationOptions(),
    (queryClient, variables) => invalidateCompanyQueries(queryClient, variables.id),
  );
}

export function useEnrichCompany() {
  return useMutation(orpcQuery.companies.enrich.mutationOptions());
}

export function useAssignCompanyContact() {
  return useInvalidatingMutation(
    orpcQuery.companies.assignContact.mutationOptions(),
    (queryClient, variables) => invalidateCompanyQueries(queryClient, variables.id),
  );
}

export function useRemoveCompanyContact() {
  return useInvalidatingMutation(
    orpcQuery.companies.removeContact.mutationOptions(),
    (queryClient, variables) => invalidateCompanyQueries(queryClient, variables.id),
  );
}
