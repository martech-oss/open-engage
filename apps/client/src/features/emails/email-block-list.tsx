import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import type { EmailBlockV2 } from "@openengage/core/messaging";

import { EmailBlockEditor } from "./email-block-editor";
import type { EmailDocumentCommand } from "./email-document-model";

export function EmailBlockList({
  blocks,
  dispatch,
}: {
  blocks: EmailBlockV2[];
  dispatch: (command: EmailDocumentCommand) => void;
}): ReactNode {
  return (
    <ItemGroup>
      {blocks.map((block, index) => (
        <Item key={block.id} variant="outline" className="items-start">
          <ItemContent className="min-w-0 gap-3">
            <ItemTitle>
              <Badge variant="secondary">{blockLabel(block.type)}</Badge>
            </ItemTitle>
            <EmailBlockEditor
              block={block}
              onChange={(next) => dispatch({ type: "update", index, block: next })}
            />
          </ItemContent>
          <ItemActions>
            <MoveButton
              label="上へ移動"
              disabled={index === 0}
              onClick={() => dispatch({ type: "move", index, offset: -1 })}
            >
              <ChevronUp />
            </MoveButton>
            <MoveButton
              label="下へ移動"
              disabled={index === blocks.length - 1}
              onClick={() => dispatch({ type: "move", index, offset: 1 })}
            >
              <ChevronDown />
            </MoveButton>
            <MoveButton
              label="ブロックを削除"
              disabled={blocks.length === 1}
              onClick={() => dispatch({ type: "delete", index })}
            >
              <Trash2 />
            </MoveButton>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function blockLabel(type: EmailBlockV2["type"]): string {
  return {
    markdown: "本文",
    image: "画像",
    button: "ボタン",
    divider: "区切り",
    spacer: "余白",
    columns: "2カラム",
    conditional: "条件分岐",
  }[type];
}
