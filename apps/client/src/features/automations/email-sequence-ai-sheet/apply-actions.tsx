import { RotateCcw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { SheetFooter } from "@/components/ui/sheet";
import type {
  EmailSequenceGenerationResult,
  EmailSequenceProposal,
} from "@openengage/core/automations";

export function EmailSequenceActions({
  prompt,
  result,
  proposal,
  previewsComplete,
  requestsReady,
  canApply,
  generatePending,
  applyPending,
  previewPending,
  onRestart,
  onSubmit,
  onApply,
}: {
  prompt: string;
  result: EmailSequenceGenerationResult | null;
  proposal: EmailSequenceProposal | null;
  previewsComplete: boolean;
  requestsReady: boolean;
  canApply: boolean;
  generatePending: boolean;
  applyPending: boolean;
  previewPending: boolean;
  onRestart: () => void;
  onSubmit: () => void;
  onApply: () => void;
}): ReactNode {
  const ready = Boolean(proposal && result?.status !== "needs_input");
  return (
    <SheetFooter>
      {result || proposal ? (
        <Button variant="ghost" disabled={generatePending || applyPending} onClick={onRestart}>
          <RotateCcw data-icon="inline-start" />
          最初からやり直す
        </Button>
      ) : null}
      {ready ? (
        <>
          <LoadingButton
            variant="outline"
            busy={generatePending || previewPending}
            busyLabel="提案を改善中…"
            disabled={!prompt.trim()}
            onClick={onSubmit}
          >
            <Sparkles data-icon="inline-start" />
            追加指示で改善
          </LoadingButton>
          <LoadingButton
            busy={applyPending}
            busyLabel="下書きを作成中…"
            disabled={generatePending || !canApply || !previewsComplete}
            onClick={onApply}
          >
            <Sparkles data-icon="inline-start" />
            テンプレートとフローの下書きを作成
          </LoadingButton>
        </>
      ) : (
        <LoadingButton
          busy={generatePending || previewPending}
          busyLabel="提案を生成中…"
          disabled={!prompt.trim() || !requestsReady}
          onClick={onSubmit}
        >
          <Sparkles data-icon="inline-start" />
          {result?.status === "needs_input" ? "選択内容で再生成" : "提案を生成"}
        </LoadingButton>
      )}
    </SheetFooter>
  );
}
