import { CircleAlert, RotateCcw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import { useAutomationAiController } from "./controller";
import { ReadyProposal } from "./proposal-preview";
import { ResourceResolutionForm } from "./reference-selection";
import type { AutomationAiSheetProps } from "./types";

export type { AutomationAiSheetProps } from "./types";
export { definitionDiff } from "./definition-diff";

export function AutomationAiSheet(props: AutomationAiSheetProps): ReactNode {
  const { open, onOpenChange, mode, currentDefinition } = props;
  const controller = useAutomationAiController(props);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{mode === "create" ? "AIでフローを作成" : "AIでフローを編集"}</SheetTitle>
          <SheetDescription>
            目的や条件を入力すると、確認可能な下書きを作成します。保存・公開は自動では行いません。
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <FieldGroup>
            <Field
              data-disabled={controller.generatePending || controller.applying}
              data-invalid={Boolean(controller.error)}
            >
              <FieldLabel htmlFor={`${mode}-automation-prompt`}>実現したいこと</FieldLabel>
              <Textarea
                id={`${mode}-automation-prompt`}
                value={controller.prompt}
                disabled={controller.generatePending || controller.applying}
                aria-invalid={Boolean(controller.error)}
                maxLength={4_000}
                rows={6}
                placeholder={
                  mode === "create"
                    ? "例: 新規登録後にウェルカムメールを送り、3日後に未開封ならフォローアップしたい"
                    : "例: 最初のメール後に2日待ち、クリックした人だけスコアを10追加したい"
                }
                onChange={(event) => controller.setPrompt(event.target.value)}
              />
              <FieldDescription>
                {controller.prompt.length.toLocaleString()} / 4,000文字
              </FieldDescription>
            </Field>
          </FieldGroup>

          {controller.error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>生成できませんでした</AlertTitle>
              <AlertDescription>{controller.error}</AlertDescription>
            </Alert>
          ) : null}

          {controller.result?.status === "needs_input" ? (
            <ResourceResolutionForm
              result={controller.result}
              selections={controller.selections}
              onSelectionChange={controller.selectResource}
            />
          ) : null}

          {controller.result?.status === "ready" ? (
            <ReadyProposal result={controller.result} currentDefinition={currentDefinition} />
          ) : null}
        </div>

        <Separator />
        <SheetFooter>
          {controller.result ? (
            <Button
              variant="ghost"
              disabled={controller.generatePending || controller.applying}
              onClick={controller.restart}
            >
              <RotateCcw data-icon="inline-start" />
              最初からやり直す
            </Button>
          ) : null}
          {controller.result?.status === "ready" ? (
            <LoadingButton
              busy={controller.applying}
              busyLabel="適用中…"
              disabled={!controller.canApply}
              onClick={() => void controller.applyProposal()}
            >
              <Sparkles data-icon="inline-start" />
              {mode === "create" ? "この内容で下書きを作成" : "キャンバスに適用"}
            </LoadingButton>
          ) : (
            <LoadingButton
              busy={controller.generatePending}
              busyLabel="提案を生成中…"
              disabled={!controller.prompt.trim() || !controller.resourceReady}
              onClick={() => void controller.submitGeneration()}
            >
              <Sparkles data-icon="inline-start" />
              {controller.result?.status === "needs_input" ? "選択内容で再生成" : "提案を生成"}
            </LoadingButton>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
