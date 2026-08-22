import { useState } from "react";

import {
  createAiProposalWorkflowKey,
  useAiProposalWorkflow,
} from "@/hooks/use-ai-proposal-workflow";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type { CompanyEnrichmentInput, CompanyEnrichmentResult } from "@openengage/core/contacts";

import { useEnrichCompany } from "./company-api";
import {
  defaultCompanyEnrichmentApplySelection,
  selectedCompanyEnrichmentValues,
} from "./enrichment-selection-model";

interface EnrichmentControllerInput {
  open: boolean;
  source: CompanyEnrichmentInput;
  currentName: string;
  currentDomain: string;
  onApply: (values: { name?: string; domain?: string }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

export function useCompanyEnrichmentController(input: EnrichmentControllerInput) {
  const enrich = useEnrichCompany();
  const [result, setResult] = useState<CompanyEnrichmentResult | null>(null);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [applyName, setApplyName] = useState(false);
  const [applyDomain, setApplyDomain] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const workflow = useAiProposalWorkflow({
    open: input.open,
    requestKey: companyEnrichmentRequestKey(input.source),
    onReset: clearState,
  });

  function clearState(): void {
    setResult(null);
    setSelectedDomain("");
    setApplyName(false);
    setApplyDomain(false);
    setApplying(false);
    setError("");
    enrich.reset();
  }

  async function research(source: CompanyEnrichmentInput): Promise<void> {
    const token = workflow.beginRequest();
    setError("");
    try {
      const next = await enrich.mutateAsync(source);
      workflow.acceptProposal(token, () => {
        setResult(next);
        if (next.status === "needs_domain") {
          setSelectedDomain(next.candidates[0]?.domain ?? "");
          return;
        }
        const selected = defaultCompanyEnrichmentApplySelection(
          input.currentName,
          input.currentDomain,
          next.proposal,
        );
        setApplyName(selected.name);
        setApplyDomain(selected.domain);
      });
    } catch (cause) {
      workflow.acceptCurrent(token, () =>
        setError(getErrorMessage(cause, "会社情報を取得できませんでした")),
      );
    }
  }

  async function apply(): Promise<void> {
    if (result?.status !== "ready" || !workflow.canApply) return;
    const values = selectedCompanyEnrichmentValues(result.proposal, {
      name: applyName,
      domain: applyDomain,
    });
    if (!values.name && !values.domain) return;
    const token = workflow.beginRequest();
    setApplying(true);
    setError("");
    try {
      await input.onApply(values);
      workflow.acceptCurrent(token, () => input.onOpenChange(false));
    } catch (cause) {
      workflow.acceptCurrent(token, () =>
        setError(getErrorMessage(cause, "提案を反映できませんでした")),
      );
    } finally {
      workflow.acceptCurrent(token, () => setApplying(false));
    }
  }

  function handleOpenChange(open: boolean): void {
    if (!open) workflow.reset();
    input.onOpenChange(open);
  }

  const canApply =
    workflow.canApply &&
    result?.status === "ready" &&
    ((applyName && Boolean(result.proposal.fields.officialName)) ||
      (applyDomain && Boolean(result.proposal.fields.domain)));

  return {
    result,
    selectedDomain,
    setSelectedDomain,
    applyName,
    setApplyName,
    applyDomain,
    setApplyDomain,
    applying,
    error,
    canApply,
    isPending: enrich.isPending,
    research,
    apply,
    restart: workflow.reset,
    handleOpenChange,
  };
}

function companyEnrichmentRequestKey(source: CompanyEnrichmentInput): string {
  if (source.source === "company")
    return createAiProposalWorkflowKey(["company-enrichment", "company", source.companyId]);
  if (source.source === "domain")
    return createAiProposalWorkflowKey([
      "company-enrichment",
      "domain",
      source.domain.trim().toLowerCase(),
    ]);
  return createAiProposalWorkflowKey(["company-enrichment", "name", source.name.trim()]);
}
