import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import {
  companiesQueryOptions,
  companyEnrichmentCapabilityQueryOptions,
  useCreateCompany,
} from "./company-api";
import { companyListColumns } from "./company-columns";

export function useCompaniesListController(initialQuery: string) {
  const { formatDate } = useWorkspaceFormatters();
  const navigate = useNavigate();
  const { data: companies } = useSuspenseQuery(companiesQueryOptions(initialQuery));
  const { data: enrichmentCapability } = useSuspenseQuery(
    companyEnrichmentCapabilityQueryOptions(),
  );
  const [query, setQuery] = useState(initialQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const createCompany = useCreateCompany();

  useDebouncedSearch({
    value: query,
    onCommit: (value) => {
      if (value === initialQuery) return;
      void navigate({ to: "/companies", search: { q: value }, replace: true });
    },
  });

  async function create(values: { name: string; domain?: string }): Promise<void> {
    const company = await createCompany.mutateAsync(values);
    toast.success("会社を作成しました");
    setCreateOpen(false);
    await navigate({ to: "/companies/$id", params: { id: company.id } });
  }

  return {
    companies,
    columns: companyListColumns(formatDate),
    enrichmentEnabled: enrichmentCapability.enabled,
    query,
    setQuery,
    createOpen,
    setCreateOpen,
    create,
  };
}
