import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

import { EmailAiActions } from "./actions";
import { useEmailAiController } from "./controller";
import { ProposalPreview } from "./proposal-preview";
import type { EmailAiSheetProps } from "./types";

export { insertGeneratedImage } from "./image-document";
export type { EmailAiSheetProps } from "./types";

export function EmailAiSheet(props: EmailAiSheetProps): ReactNode {
  const controller = useEmailAiController(props);
  return (
    <Sheet open={props.open} onOpenChange={controller.handleOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {props.mode === "create" ? "AIでメールを作成" : "AIでメールを改善"}
          </SheetTitle>
          <SheetDescription>
            React Email用の構造化された提案を作ります。下書きへの適用・保存・公開は別操作です。
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {props.purpose === "transactional" ? "Transactional" : "Marketing"}
            </Badge>
            {props.purpose === "marketing" ? (
              <Badge variant="outline">送信機能は未提供</Badge>
            ) : null}
          </div>

          <FieldGroup>
            <Field
              data-disabled={controller.generatePending}
              data-invalid={Boolean(controller.error)}
            >
              <FieldLabel htmlFor="email-ai-prompt">作りたいメール</FieldLabel>
              <Textarea
                id="email-ai-prompt"
                value={controller.prompt}
                disabled={controller.generatePending}
                aria-invalid={Boolean(controller.error)}
                maxLength={4_000}
                rows={6}
                placeholder={
                  props.mode === "create"
                    ? "例: 資料請求のお礼と、担当者から1営業日以内に連絡することを伝えたい"
                    : "例: 件名を短くし、最初の段落を親しみやすく、CTAを1つに絞って"
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
              <AlertTitle>処理できませんでした</AlertTitle>
              <AlertDescription>{controller.error}</AlertDescription>
            </Alert>
          ) : null}
          {controller.result ? (
            <ProposalPreview
              result={controller.result}
              preview={controller.preview}
              imageRequest={controller.imageRequest}
              generatedImage={controller.generatedImage}
              imagePending={controller.imagePending}
              onImageRequestChange={controller.setImageRequest}
              onGenerateImage={() => void controller.createImage()}
            />
          ) : null}
        </div>

        <Separator />
        <EmailAiActions
          hasResult={Boolean(controller.result)}
          promptReady={Boolean(controller.prompt.trim())}
          canApply={controller.canApply}
          generatePending={controller.generatePending}
          previewPending={controller.previewPending}
          onRestart={controller.restart}
          onGenerate={() => void controller.submitGeneration()}
          onApply={controller.applyProposal}
        />
      </SheetContent>
    </Sheet>
  );
}
