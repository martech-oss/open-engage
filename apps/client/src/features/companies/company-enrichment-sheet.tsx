import { CircleAlert, Info, RotateCcw, Search, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CompanyEnrichmentInput } from "@openengage/core/contacts";

import { EnrichmentCandidateView } from "./enrichment-candidate-view";
import { useCompanyEnrichmentController } from "./enrichment-controller";
import { EnrichmentProposalReview } from "./enrichment-proposal-review";

export {
  defaultCompanyEnrichmentApplySelection,
  selectedCompanyEnrichmentValues,
} from "./enrichment-selection-model";

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
  const controller = useCompanyEnrichmentController({
    open,
    onOpenChange,
    source,
    currentName,
    currentDomain,
    onApply,
  });
  const result = controller.result;

  return (
    <Sheet open={open} onOpenChange={controller.handleOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>会社情報を取得</SheetTitle>
          <SheetDescription>
            公開情報を調査し、根拠付きの候補を作成します。会社情報は自動保存されません。
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {controller.isPending ? (
            <Alert>
              <Search />
              <AlertTitle>会社情報を調査しています</AlertTitle>
              <AlertDescription>
                公式サイトの確認、必要なページの描画、根拠の整理を行っています。最大90秒ほどかかります。
              </AlertDescription>
            </Alert>
          ) : null}
          {controller.error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>処理できませんでした</AlertTitle>
              <AlertDescription>{controller.error}</AlertDescription>
            </Alert>
          ) : null}
          {result?.status === "needs_domain" ? (
            <EnrichmentCandidateView
              result={result}
              selectedDomain={controller.selectedDomain}
              onSelectedDomainChange={controller.setSelectedDomain}
            />
          ) : null}
          {result?.status === "ready" ? (
            <EnrichmentProposalReview
              proposal={result.proposal}
              currentName={currentName}
              currentDomain={currentDomain}
              applyName={controller.applyName}
              applyDomain={controller.applyDomain}
              onApplyNameChange={controller.setApplyName}
              onApplyDomainChange={controller.setApplyDomain}
            />
          ) : null}
          {!result && !controller.isPending ? (
            <Alert>
              <Info />
              <AlertTitle>取得元</AlertTitle>
              <AlertDescription>{sourceDescription(source)}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <Separator />
        <EnrichmentFooter source={source} controller={controller} />
      </SheetContent>
    </Sheet>
  );
}

function EnrichmentFooter({
  source,
  controller,
}: {
  source: CompanyEnrichmentInput;
  controller: ReturnType<typeof useCompanyEnrichmentController>;
}): ReactNode {
  const result = controller.result;
  return (
    <SheetFooter>
      {result ? (
        <Button
          variant="ghost"
          disabled={controller.isPending || controller.applying}
          onClick={controller.restart}
        >
          <RotateCcw data-icon="inline-start" />
          最初から
        </Button>
      ) : null}
      {result?.status === "ready" ? (
        <LoadingButton
          busy={controller.applying}
          busyLabel="反映中…"
          disabled={!controller.canApply}
          onClick={() => void controller.apply()}
        >
          <Sparkles data-icon="inline-start" />
          選択した項目を反映
        </LoadingButton>
      ) : result?.status === "needs_domain" ? (
        <LoadingButton
          busy={controller.isPending}
          busyLabel="調査中…"
          disabled={!controller.selectedDomain}
          onClick={() =>
            void controller.research({ source: "domain", domain: controller.selectedDomain })
          }
        >
          <Search data-icon="inline-start" />
          このドメインを調査
        </LoadingButton>
      ) : (
        <LoadingButton
          busy={controller.isPending}
          busyLabel="調査中…"
          onClick={() => void controller.research(source)}
        >
          <Sparkles data-icon="inline-start" />
          会社情報を取得
        </LoadingButton>
      )}
    </SheetFooter>
  );
}

function sourceDescription(source: CompanyEnrichmentInput): string {
  if (source.source === "company") return "現在の会社名またはドメインを使って調査します。";
  if (source.source === "domain") return `${source.domain} の公式サイトを直接調査します。`;
  return `「${source.name}」の公式サイトを検索してから調査します。`;
}
