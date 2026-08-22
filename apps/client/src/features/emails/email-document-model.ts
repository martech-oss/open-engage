import type { EmailBlockV2, EmailDocumentV2 } from "@openengage/core/messaging";

export type AddableEmailBlockType = "markdown" | "button" | "divider" | "spacer";

export type EmailDocumentCommand =
  | { type: "add"; block: EmailBlockV2 }
  | { type: "update"; index: number; block: EmailBlockV2 }
  | { type: "move"; index: number; offset: -1 | 1 }
  | { type: "delete"; index: number };

export function createEmailBlock(type: AddableEmailBlockType, id: string): EmailBlockV2 {
  if (type === "markdown") return { id, type, markdown: "本文を入力してください。" };
  if (type === "button") {
    return {
      id,
      type,
      label: "詳しく見る",
      href: "https://example.com",
      variant: "primary",
      align: "center",
    };
  }
  if (type === "divider") return { id, type };
  return { id, type, height: 24 };
}

export function createEmailImageBlock(
  asset: { id: string; name: string },
  id: string,
  documentWidth: number,
): EmailBlockV2 {
  return {
    id,
    type: "image",
    source: { kind: "asset", assetId: asset.id },
    alt: asset.name,
    width: Math.min(documentWidth - 48, 672),
    align: "center",
  };
}

export function reduceEmailDocument(
  document: EmailDocumentV2,
  command: EmailDocumentCommand,
): EmailDocumentV2 {
  if (command.type === "add") {
    return { ...document, blocks: [...document.blocks, command.block] };
  }
  if (command.index < 0 || command.index >= document.blocks.length) return document;
  if (command.type === "update") {
    return {
      ...document,
      blocks: document.blocks.map((block, index) =>
        index === command.index ? command.block : block,
      ),
    };
  }
  if (command.type === "delete") {
    if (document.blocks.length === 1) return document;
    return {
      ...document,
      blocks: document.blocks.filter((_, index) => index !== command.index),
    };
  }
  const nextIndex = command.index + command.offset;
  if (nextIndex < 0 || nextIndex >= document.blocks.length) return document;
  const blocks = [...document.blocks];
  const current = blocks[command.index];
  const target = blocks[nextIndex];
  if (!current || !target) return document;
  blocks[command.index] = target;
  blocks[nextIndex] = current;
  return { ...document, blocks };
}
