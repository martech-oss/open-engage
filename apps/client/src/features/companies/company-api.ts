import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";

import { orpc, orpcQuery } from "@/lib/orpc";
import type {
  CompanyContactDto,
  CompanyDetail,
  CompanyEnrichmentInput,
  CompanyEnrichmentResult,
  CompanySummary,
} from "@openengage/core/contacts";

export type {
  CompanyContactDto,
  CompanyDetail,
  CompanyEnrichmentInput,
  CompanyEnrichmentResult,
  CompanySummary,
};

/** A contact offered when attaching one to a company. */
export interface ContactOption {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

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

/** Active contacts offered when assigning one to a company. */
export function companyContactOptionsQueryOptions() {
  return orpcQuery.contacts.list.queryOptions({
    input: { limit: 100, status: "active", sort: "name", direction: "asc" },
  });
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
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.companies.create.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpcQuery.companies.list.key() }),
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.companies.update.mutationOptions(),
    onSuccess: (_data, variables) => invalidateCompanyQueries(queryClient, variables.id),
  });
}

export function useEnrichCompany() {
  return useMutation(orpcQuery.companies.enrich.mutationOptions());
}

export function useAssignCompanyContact() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.companies.assignContact.mutationOptions(),
    onSuccess: (_data, variables) => invalidateCompanyQueries(queryClient, variables.id),
  });
}

export function useRemoveCompanyContact() {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpcQuery.companies.removeContact.mutationOptions(),
    onSuccess: (_data, variables) => invalidateCompanyQueries(queryClient, variables.id),
  });
}
