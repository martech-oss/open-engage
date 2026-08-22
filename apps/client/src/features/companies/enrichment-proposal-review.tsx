import { ExternalLink, Info } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import type {
  CompanyEnrichmentFieldName,
  CompanyEnrichmentProposal,
} from "@openengage/core/contacts";

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

export function EnrichmentProposalReview({
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
  if (Array.isArray(value))
    return value
      .map((item) =>
        typeof item === "object" && item !== null
          ? "url" in item && "network" in item
            ? `${String(item.network)}: ${String(item.url)}`
            : JSON.stringify(item)
          : String(item),
      )
      .join("\n");
  return String(value);
}
