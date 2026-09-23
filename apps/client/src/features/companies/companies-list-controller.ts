import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { useUrlSearchDraft } from "@/hooks/use-url-search-draft";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import {
  companiesQueryOptions,
  companyEnrichmentCapabilityQueryOptions,
  useCreateCompany,
} from "./company-api";
import { companyListColumns } from "./company-columns";

export function useCompaniesListController(urlQuery: string) {
  const { formatDate } = useWorkspaceFormatters();
  const navigate = useNavigate();
  const { data: companies } = useSuspenseQuery(companiesQueryOptions(urlQuery));
  const { data: enrichmentCapability } = useSuspenseQuery(
    companyEnrichmentCapabilityQueryOptions(),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const createCompany = useCreateCompany();

  const [query, setQuery] = useUrlSearchDraft({
    value: urlQuery,
    onCommit: (value) => {
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
