import { CircleAlert, ExternalLink, Info, RotateCcw, Search, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  createAiProposalWorkflowKey,
  useAiProposalWorkflow,
} from "@/hooks/use-ai-proposal-workflow";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type {
  CompanyEnrichmentFieldName,
  CompanyEnrichmentInput,
  CompanyEnrichmentProposal,
  CompanyEnrichmentResult,
} from "@openengage/core/contacts";

import { useEnrichCompany } from "./company-api";

const fieldLabels: Record<CompanyEnrichmentFieldName, string> = {
  officialName: "正式名称",
  domain: "ドメイン",
  description: "会社概要",
  industries: "業種",
  productsServices: "製品・サービス",
  headquarters: "所在地",
  phone: "電話番号",
  foundedYear: "設立年",
  employeeRange: "従業員規模",
  socialUrls: "ソーシャルURL",
  logoUrl: "ロゴURL",
};

const confidenceLabels = { high: "高", medium: "中", low: "低" } as const;

export function CompanyEnrichmentSheet({
  open,
  onOpenChange,
  source,
  currentName,
  currentDomain,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: CompanyEnrichmentInput;
  currentName: string;
  currentDomain: string;
  onApply: (values: { name?: string; domain?: string }) => Promise<void>;
}): ReactNode {
  const enrich = useEnrichCompany();
  const [result, setResult] = useState<CompanyEnrichmentResult | null>(null);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [applyName, setApplyName] = useState(false);
  const [applyDomain, setApplyDomain] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const workflow = useAiProposalWorkflow({
    open,
    requestKey: companyEnrichmentRequestKey(source),
    onReset: clearState,
  });

  async function research(input: CompanyEnrichmentInput): Promise<void> {
    const token = workflow.beginRequest();
    setError("");
    try {
      const next = await enrich.mutateAsync(input);
      workflow.acceptProposal(token, () => {
        setResult(next);
        if (next.status === "needs_domain") {
          setSelectedDomain(next.candidates[0]?.domain ?? "");
          return;
        }
        const selection = defaultCompanyEnrichmentApplySelection(
          currentName,
          currentDomain,
          next.proposal,
        );
        setApplyName(selection.name);
        setApplyDomain(selection.domain);
      });
    } catch (cause) {
      workflow.acceptCurrent(token, () => {
        setError(getErrorMessage(cause, "会社情報を取得できませんでした"));
      });
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
      await onApply(values);
      workflow.acceptCurrent(token, () => onOpenChange(false));
    } catch (cause) {
      workflow.acceptCurrent(token, () => {
        setError(getErrorMessage(cause, "提案を反映できませんでした"));
      });
    } finally {
      workflow.acceptCurrent(token, () => setApplying(false));
    }
  }

  function clearState(): void {
    setResult(null);
    setSelectedDomain("");
    setApplyName(false);
    setApplyDomain(false);
    setApplying(false);
    setError("");
    enrich.reset();
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) workflow.reset();
    onOpenChange(nextOpen);
  }

  function restart(): void {
    workflow.reset();
  }

  const canApply =
    workflow.canApply &&
    result?.status === "ready" &&
    ((applyName && Boolean(result.proposal.fields.officialName)) ||
      (applyDomain && Boolean(result.proposal.fields.domain)));

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>会社情報を取得</SheetTitle>
          <SheetDescription>
            公開情報を調査し、根拠付きの候補を作成します。会社情報は自動保存されません。
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {enrich.isPending ? (
            <Alert>
              <Search />
              <AlertTitle>会社情報を調査しています</AlertTitle>
              <AlertDescription>
                公式サイトの確認、必要なページの描画、根拠の整理を行っています。最大90秒ほどかかります。
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>処理できませんでした</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {result?.status === "needs_domain" ? (
            <DomainCandidates
              result={result}
              selectedDomain={selectedDomain}
              onSelectedDomainChange={setSelectedDomain}
            />
          ) : null}
          {result?.status === "ready" ? (
            <ProposalReview
              proposal={result.proposal}
              currentName={currentName}
              currentDomain={currentDomain}
              applyName={applyName}
              applyDomain={applyDomain}
              onApplyNameChange={setApplyName}
              onApplyDomainChange={setApplyDomain}
            />
          ) : null}
          {!result && !enrich.isPending ? (
            <Alert>
              <Info />
              <AlertTitle>取得元</AlertTitle>
              <AlertDescription>
                {source.source === "company"
                  ? "現在の会社名またはドメインを使って調査します。"
                  : source.source === "domain"
                    ? `${source.domain} の公式サイトを直接調査します。`
                    : `「${source.name}」の公式サイトを検索してから調査します。`}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <Separator />
        <SheetFooter>
          {result ? (
            <Button variant="ghost" disabled={enrich.isPending || applying} onClick={restart}>
              <RotateCcw data-icon="inline-start" />
              最初から
            </Button>
          ) : null}
          {result?.status === "ready" ? (
            <LoadingButton
              busy={applying}
              busyLabel="反映中…"
              disabled={!canApply}
              onClick={() => void apply()}
            >
              <Sparkles data-icon="inline-start" />
              選択した項目を反映
            </LoadingButton>
          ) : result?.status === "needs_domain" ? (
            <LoadingButton
              busy={enrich.isPending}
              busyLabel="調査中…"
              disabled={!selectedDomain}
              onClick={() => void research({ source: "domain", domain: selectedDomain })}
            >
              <Search data-icon="inline-start" />
              このドメインを調査
            </LoadingButton>
          ) : (
            <LoadingButton
              busy={enrich.isPending}
              busyLabel="調査中…"
              onClick={() => void research(source)}
            >
              <Sparkles data-icon="inline-start" />
              会社情報を取得
            </LoadingButton>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function companyEnrichmentRequestKey(source: CompanyEnrichmentInput): string {
  if (source.source === "company") {
    return createAiProposalWorkflowKey(["company-enrichment", "company", source.companyId]);
  }
  if (source.source === "domain") {
    return createAiProposalWorkflowKey([
      "company-enrichment",
      "domain",
      source.domain.trim().toLowerCase(),
    ]);
  }
  return createAiProposalWorkflowKey(["company-enrichment", "name", source.name.trim()]);
}

function DomainCandidates({
  result,
  selectedDomain,
  onSelectedDomainChange,
}: {
  result: Extract<CompanyEnrichmentResult, { status: "needs_domain" }>;
  selectedDomain: string;
  onSelectedDomainChange: (value: string) => void;
}): ReactNode {
  return (
    <div className="space-y-4">
      <Alert>
        <Info />
        <AlertTitle>公式サイトを確認してください</AlertTitle>
        <AlertDescription>{result.reason}</AlertDescription>
      </Alert>
      {result.candidates.length > 0 ? (
        <NativeSelect
          className="w-full"
          aria-label="公式サイト候補"
          value={selectedDomain}
          onChange={(event) => onSelectedDomainChange(event.target.value)}
        >
          {result.candidates.map((candidate) => (
            <NativeSelectOption key={candidate.domain} value={candidate.domain}>
              {candidate.name} — {candidate.domain}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>公式サイトを特定できませんでした</AlertTitle>
          <AlertDescription>
            会社編集画面でドメインを入力してから再実行してください。
          </AlertDescription>
        </Alert>
      )}
      <ItemGroup>
        {result.candidates.map((candidate) => (
          <Item key={candidate.url} variant="outline" size="sm">
            <ItemContent>
              <ItemTitle>{candidate.domain}</ItemTitle>
              <ItemDescription>{candidate.reason}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}

function ProposalReview({
  proposal,
  currentName,
  currentDomain,
  applyName,
  applyDomain,
  onApplyNameChange,
  onApplyDomainChange,
}: {
  proposal: CompanyEnrichmentProposal;
  currentName: string;
  currentDomain: string;
  applyName: boolean;
  applyDomain: boolean;
  onApplyNameChange: (value: boolean) => void;
  onApplyDomainChange: (value: boolean) => void;
}): ReactNode {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-medium">反映する項目</h3>
        {proposal.fields.officialName ? (
          <ApplyField
            id="apply-enriched-company-name"
            label="会社名"
            currentValue={currentName}
            proposedValue={proposal.fields.officialName.value}
            checked={applyName}
            onCheckedChange={onApplyNameChange}
          />
        ) : null}
        {proposal.fields.domain ? (
          <ApplyField
            id="apply-enriched-company-domain"
            label="ドメイン"
            currentValue={currentDomain || "未設定"}
            proposedValue={proposal.fields.domain.value}
            checked={applyDomain}
            onCheckedChange={onApplyDomainChange}
          />
        ) : null}
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-medium">取得した情報</h3>
        <ItemGroup>
          {Object.entries(proposal.fields).map(([field, sourced]) =>
            sourced ? (
              <Item key={field} variant="outline" size="sm">
                <ItemContent>
                  <div className="flex flex-wrap items-center gap-2">
                    <ItemTitle>{fieldLabels[field as CompanyEnrichmentFieldName]}</ItemTitle>
                    <Badge variant="secondary">信頼度 {confidenceLabels[sourced.confidence]}</Badge>
                    {field !== "officialName" && field !== "domain" ? (
                      <Badge variant="outline">保存先未対応</Badge>
                    ) : null}
                  </div>
                  <ItemDescription className="whitespace-pre-wrap">
                    {formatValue(sourced.value)}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ) : null,
          )}
        </ItemGroup>
      </div>
      {proposal.warnings.length > 0 ? (
        <Alert>
          <Info />
          <AlertTitle>確認事項</AlertTitle>
          <AlertDescription>
            {proposal.warnings.map((warning) => warning.message).join(" / ")}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">根拠</h3>
        {proposal.sources.map((source) => (
          <Button
            key={source.id}
            variant="link"
            className="h-auto max-w-full justify-start p-0 text-left"
            nativeButton={false}
            render={
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${source.title}を開く`}
              />
            }
          >
            <ExternalLink data-icon="inline-start" />
            <span className="truncate">{source.title}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function ApplyField({
  id,
  label,
  currentValue,
  proposedValue,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  currentValue: string;
  proposedValue: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}): ReactNode {
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
      />
      <FieldContent>
        <FieldLabel htmlFor={id}>
          <FieldTitle>{label}</FieldTitle>
        </FieldLabel>
        <p className="text-sm text-muted-foreground">現在: {currentValue}</p>
        <p className="text-sm">候補: {proposedValue}</p>
      </FieldContent>
    </Field>
  );
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "object" && item !== null
          ? "url" in item && "network" in item
            ? `${String(item.network)}: ${String(item.url)}`
            : JSON.stringify(item)
          : String(item),
      )
      .join("\n");
  }
  return String(value);
}

export function defaultCompanyEnrichmentApplySelection(
  currentName: string,
  currentDomain: string,
  proposal: CompanyEnrichmentProposal,
): { name: boolean; domain: boolean } {
  const proposedName = proposal.fields.officialName?.value;
  const proposedDomain = proposal.fields.domain?.value;
  return {
    name: Boolean(proposedName) && (!currentName || proposedName === currentName),
    domain: Boolean(proposedDomain) && (!currentDomain || proposedDomain === currentDomain),
  };
}

export function selectedCompanyEnrichmentValues(
  proposal: CompanyEnrichmentProposal,
  selection: { name: boolean; domain: boolean },
): { name?: string; domain?: string } {
  const name = proposal.fields.officialName?.value;
  const domain = proposal.fields.domain?.value;
  return {
    ...(selection.name && name ? { name } : {}),
    ...(selection.domain && domain ? { domain } : {}),
  };
}
