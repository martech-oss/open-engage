import { CircleAlert, Info } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { CompanyEnrichmentResult } from "@openengage/core/contacts";

export function EnrichmentCandidateView({
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
