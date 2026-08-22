import { ImageIcon, LinkIcon, Minus, Plus, Type } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";

import { FormInput } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import type { EmailDocumentV2 } from "@openengage/core/messaging";

import { EmailBlockList } from "./email-block-list";
import {
  createEmailBlock,
  createEmailImageBlock,
  type EmailDocumentCommand,
  reduceEmailDocument,
} from "./email-document-model";
import { EmailDocumentThemeEditor } from "./email-document-theme-editor";

const AssetPickerDialog = lazy(async () => ({
  default: (await import("@/features/assets/asset-picker")).AssetPickerDialog,
}));

export function EmailDocumentEditor({
  value,
  onChange,
}: {
  value: EmailDocumentV2;
  onChange: (value: EmailDocumentV2) => void;
}): ReactNode {
  const [addImagePickerOpen, setAddImagePickerOpen] = useState(false);
  const dispatch = (command: EmailDocumentCommand) => onChange(reduceEmailDocument(value, command));

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup>
        <FormInput
          label="プレビューテキスト"
          name="previewText"
          value={value.previewText}
          maxLength={200}
          placeholder="受信トレイで件名の後に表示される短い説明"
          onChange={(event) => onChange({ ...value, previewText: event.target.value })}
        />
      </FieldGroup>
      <EmailDocumentThemeEditor
        theme={value.theme}
        onChange={(theme) => onChange({ ...value, theme })}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">コンテンツ</p>
          <p className="text-sm text-muted-foreground">ブロック単位で安全に編集できます。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AddBlockButton label="本文" icon={<Type />} onClick={() => addBlock("markdown")} />
          <AddBlockButton label="ボタン" icon={<LinkIcon />} onClick={() => addBlock("button")} />
          <AddBlockButton
            label="画像"
            icon={<ImageIcon />}
            onClick={() => setAddImagePickerOpen(true)}
          />
          <AddBlockButton label="区切り" icon={<Minus />} onClick={() => addBlock("divider")} />
          <AddBlockButton label="余白" icon={<Plus />} onClick={() => addBlock("spacer")} />
        </div>
      </div>
      <EmailBlockList blocks={value.blocks} dispatch={dispatch} />
      {addImagePickerOpen ? (
        <Suspense fallback={null}>
          <AssetPickerDialog
            open
            onOpenChange={setAddImagePickerOpen}
            onSelect={(asset) => {
              dispatch({
                type: "add",
                block: createEmailImageBlock(asset, crypto.randomUUID(), value.theme.width),
              });
              setAddImagePickerOpen(false);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );

  function addBlock(type: Parameters<typeof createEmailBlock>[0]): void {
    dispatch({ type: "add", block: createEmailBlock(type, crypto.randomUUID()) });
  }
}

function AddBlockButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}): ReactNode {
  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick}>
      <span data-icon="inline-start">{icon}</span>
      {label}
    </Button>
  );
}
