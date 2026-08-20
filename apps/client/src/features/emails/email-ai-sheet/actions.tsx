import { RotateCcw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { SheetFooter } from "@/components/ui/sheet";

export function EmailAiActions({
  hasResult,
  promptReady,
  canApply,
  generatePending,
  previewPending,
  onRestart,
  onGenerate,
  onApply,
}: {
  hasResult: boolean;
  promptReady: boolean;
  canApply: boolean;
  generatePending: boolean;
  previewPending: boolean;
  onRestart: () => void;
  onGenerate: () => void;
  onApply: () => void;
}): ReactNode {
  return (
    <SheetFooter>
      {hasResult ? (
        <Button variant="ghost" disabled={generatePending} onClick={onRestart}>
          <RotateCcw data-icon="inline-start" />
          最初からやり直す
        </Button>
      ) : null}
      {hasResult ? (
        <Button disabled={!canApply} onClick={onApply}>
          <Sparkles data-icon="inline-start" />
          この提案を下書きに適用
        </Button>
      ) : (
        <LoadingButton
          busy={generatePending || previewPending}
          busyLabel="提案を生成中…"
          disabled={!promptReady}
          onClick={onGenerate}
        >
          <Sparkles data-icon="inline-start" />
          提案を生成
        </LoadingButton>
      )}
    </SheetFooter>
  );
}
