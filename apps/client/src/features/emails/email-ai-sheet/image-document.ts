import type {
  EmailDocumentV2,
  EmailImageRequest,
  GeneratedEmailImage,
} from "@openengage/core/messaging";

export function insertGeneratedImage(
  document: EmailDocumentV2,
  request: EmailImageRequest,
  image: GeneratedEmailImage,
): EmailDocumentV2 {
  const block = {
    id: `generated-${image.assetId}`,
    type: "image" as const,
    source: { kind: "asset" as const, assetId: image.assetId },
    alt: image.alt,
    width: Math.min(document.theme.width - 48, 672),
    align: "center" as const,
  };
  if (request.afterBlockId === null) return { ...document, blocks: [block, ...document.blocks] };
  const index = document.blocks.findIndex((current) => current.id === request.afterBlockId);
  if (index < 0) return { ...document, blocks: [...document.blocks, block] };
  return {
    ...document,
    blocks: [...document.blocks.slice(0, index + 1), block, ...document.blocks.slice(index + 1)],
  };
}
