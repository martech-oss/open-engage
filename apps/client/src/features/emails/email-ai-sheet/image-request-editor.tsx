import { ImageIcon } from "lucide-react";
import type { ReactNode } from "react";

import { LoadingButton } from "@/components/app-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { EmailImageRequest, GeneratedEmailImage } from "@openengage/core/messaging";

export function ImageRequestEditor({
  request,
  image,
  busy,
  onChange,
  onGenerate,
}: {
  request: EmailImageRequest;
  image: GeneratedEmailImage | null;
  busy: boolean;
  onChange: (request: EmailImageRequest) => void;
  onGenerate: () => void;
}): ReactNode {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>画像の提案</CardTitle>
        <CardDescription>内容を確認してから画像生成を実行します。最大1枚です。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email-image-prompt">画像プロンプト</FieldLabel>
            <Textarea
              id="email-image-prompt"
              value={request.prompt}
              maxLength={2_000}
              rows={4}
              onChange={(event) => onChange({ ...request, prompt: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email-image-alt">代替テキスト</FieldLabel>
            <Textarea
              id="email-image-alt"
              value={request.alt}
              maxLength={500}
              rows={2}
              onChange={(event) => onChange({ ...request, alt: event.target.value })}
            />
          </Field>
        </FieldGroup>
        {image ? (
          <img
            src={image.previewUrl}
            alt={image.alt}
            className="max-h-72 rounded-lg border object-contain"
          />
        ) : null}
        <LoadingButton
          type="button"
          variant="outline"
          busy={busy}
          busyLabel="画像を生成中…"
          disabled={!request.prompt.trim() || !request.alt.trim()}
          onClick={onGenerate}
        >
          <ImageIcon data-icon="inline-start" />
          {image ? "画像を再生成" : "画像を生成"}
        </LoadingButton>
      </CardContent>
    </Card>
  );
}
