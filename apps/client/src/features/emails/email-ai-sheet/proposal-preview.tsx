import { Info, Sparkles, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import type {
  EmailGenerationResult,
  EmailImageRequest,
  GeneratedEmailImage,
} from "@openengage/core/messaging";

import { ImageRequestEditor } from "./image-request-editor";

export function ProposalPreview({
  result,
  preview,
  imageRequest,
  generatedImage,
  imagePending,
  onImageRequestChange,
  onGenerateImage,
}: {
  result: EmailGenerationResult;
  preview: { subject: string; html: string; text: string } | null;
  imageRequest: EmailImageRequest | null;
  generatedImage: GeneratedEmailImage | null;
  imagePending: boolean;
  onImageRequestChange: (request: EmailImageRequest) => void;
  onGenerateImage: () => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Sparkles />
        <AlertTitle>{result.proposal.name}</AlertTitle>
        <AlertDescription>{result.summary}</AlertDescription>
      </Alert>

      <ItemGroup>
        <Item variant="outline" size="sm">
          <ItemContent>
            <ItemTitle>件名</ItemTitle>
            <p className="text-sm text-muted-foreground">{result.proposal.subject}</p>
          </ItemContent>
        </Item>
        <Item variant="outline" size="sm">
          <ItemContent>
            <ItemTitle>構成</ItemTitle>
            <p className="text-sm text-muted-foreground">
              {result.proposal.content.blocks.length}ブロック
            </p>
          </ItemContent>
        </Item>
      </ItemGroup>

      {preview ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">{preview.subject}</p>
          <iframe
            title="AIメール提案プレビュー"
            srcDoc={preview.html}
            sandbox=""
            className="h-96 w-full rounded-lg border"
          />
        </div>
      ) : null}

      {imageRequest ? (
        <ImageRequestEditor
          request={imageRequest}
          image={generatedImage}
          busy={imagePending}
          onChange={onImageRequestChange}
          onGenerate={onGenerateImage}
        />
      ) : null}

      {result.assumptions.length > 0 ? (
        <Alert>
          <Info />
          <AlertTitle>AIが置いた前提</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {result.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {result.warnings.length > 0 ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>確認事項</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
