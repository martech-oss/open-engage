import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import { EmailSequenceActions } from "./apply-actions";
import { useEmailSequenceAiController } from "./controller";
import { NeedsInput } from "./needs-input";
import { ReadySequence } from "./ready-sequence";
import type { EmailSequenceAiSheetProps } from "./types";

export type { EmailSequenceAiSheetProps } from "./types";
export { buildSequenceResolutions } from "./resolutions";

export function EmailSequenceAiSheet(props: EmailSequenceAiSheetProps): ReactNode {
  const controller = useEmailSequenceAiController(props);
  const disabled = controller.generatePending || controller.applyPending;
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>AIでメールシーケンスを作成</SheetTitle>
          <SheetDescription>
            2〜8通のメール、間隔、分岐、終了条件を設計します。確認後も下書きのみ作成し、公開や送信は行いません。
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <FieldGroup>
            <Field data-disabled={disabled}>
              <FieldLabel htmlFor="email-sequence-prompt">実現したいライフサイクル施策</FieldLabel>
              <Textarea
                id="email-sequence-prompt"
                value={controller.prompt}
                maxLength={4_000}
                rows={6}
                disabled={disabled}
                placeholder="例: トライアル登録者に14日間でオンボーディングメールを送り、最初のキャンペーン公開を促したい。公開済みなら以降は終了する。"
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
              <AlertTitle>処理できませんでした</AlertTitle>
              <AlertDescription>{controller.error}</AlertDescription>
            </Alert>
          ) : null}
          {controller.result?.status === "needs_input" ? (
            <NeedsInput
              result={controller.result}
              values={controller.values}
              onChange={controller.setValues}
            />
          ) : null}
          {controller.proposal && controller.result?.status !== "needs_input" ? (
            <ReadySequence
              proposal={controller.proposal}
              previews={controller.previews}
              selectedEmailRef={controller.selectedEmailRef}
              onSelectEmail={controller.setSelectedEmailRef}
              onChooseSubject={controller.chooseSubject}
            />
          ) : null}
        </div>

        <Separator />
        <EmailSequenceActions
          prompt={controller.prompt}
          result={controller.result}
          proposal={controller.proposal}
          previewsComplete={
            Boolean(controller.proposal) &&
            Object.keys(controller.previews).length === controller.proposal?.emails.length
          }
          requestsReady={controller.requestsReady}
          canApply={controller.canApply}
          generatePending={controller.generatePending}
          applyPending={controller.applyPending}
          previewPending={controller.previewPending}
          onRestart={controller.restart}
          onSubmit={() => void controller.submit()}
          onApply={() => void controller.applyProposal()}
        />
      </SheetContent>
    </Sheet>
  );
}
