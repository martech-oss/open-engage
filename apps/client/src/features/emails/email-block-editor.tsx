import { ImageIcon } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";

import { FormInput, FormTextarea } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { assetRawUrl, type AssetSummary } from "@/features/assets/asset-api";
import type { EmailBlockV2, EmailLeafBlockV2 } from "@openengage/core/messaging";

const AssetPickerDialog = lazy(async () => ({
  default: (await import("@/features/assets/asset-picker")).AssetPickerDialog,
}));

export function EmailBlockEditor({
  block,
  onChange,
}: {
  block: EmailBlockV2;
  onChange: (block: EmailBlockV2) => void;
}): ReactNode {
  if (block.type === "columns") {
    return (
      <FieldGroup className="sm:grid sm:grid-cols-2">
        {block.columns.map((column, columnIndex) => (
          <div key={columnIndex} className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">列 {columnIndex + 1}</p>
            {column.blocks.map((child, childIndex) => (
              <EmailLeafBlockEditor
                key={child.id}
                block={child}
                onChange={(next) =>
                  onChange({
                    ...block,
                    columns: block.columns.map((currentColumn, currentColumnIndex) =>
                      currentColumnIndex === columnIndex
                        ? {
                            blocks: currentColumn.blocks.map((current, currentIndex) =>
                              currentIndex === childIndex ? next : current,
                            ),
                          }
                        : currentColumn,
                    ) as typeof block.columns,
                  })
                }
              />
            ))}
          </div>
        ))}
      </FieldGroup>
    );
  }
  if (block.type === "conditional") {
    return (
      <FieldGroup>
        <FieldGroup className="sm:grid sm:grid-cols-2">
          <FormInput
            label="連絡先フィールド"
            name={`${block.id}-field`}
            value={block.field}
            onChange={(event) => onChange({ ...block, field: event.target.value })}
          />
          <FormInput
            label="一致する値"
            name={`${block.id}-equals`}
            value={String(block.equals)}
            onChange={(event) => onChange({ ...block, equals: event.target.value })}
          />
        </FieldGroup>
        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
          {block.blocks.map((child, index) => (
            <EmailLeafBlockEditor
              key={child.id}
              block={child}
              onChange={(next) =>
                onChange({
                  ...block,
                  blocks: block.blocks.map((current, childIndex) =>
                    childIndex === index ? next : current,
                  ),
                })
              }
            />
          ))}
        </div>
      </FieldGroup>
    );
  }
  return <EmailLeafBlockEditor block={block} onChange={onChange} />;
}

function EmailLeafBlockEditor({
  block,
  onChange,
}: {
  block: EmailLeafBlockV2;
  onChange: (block: EmailLeafBlockV2) => void;
}): ReactNode {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (block.type === "markdown") {
    return (
      <FormTextarea
        label="Markdown"
        name={`${block.id}-markdown`}
        value={block.markdown}
        rows={6}
        onChange={(event) => onChange({ ...block, markdown: event.target.value })}
      />
    );
  }
  if (block.type === "button") {
    return (
      <FieldGroup className="sm:grid sm:grid-cols-2">
        <FormInput
          label="ラベル"
          name={`${block.id}-label`}
          value={block.label}
          onChange={(event) => onChange({ ...block, label: event.target.value })}
        />
        <FormInput
          label="リンク先"
          name={`${block.id}-href`}
          value={block.href}
          onChange={(event) => onChange({ ...block, href: event.target.value })}
        />
      </FieldGroup>
    );
  }
  if (block.type === "image")
    return (
      <EmailImageBlockEditor
        block={block}
        onChange={onChange}
        pickerOpen={pickerOpen}
        setPickerOpen={setPickerOpen}
      />
    );
  if (block.type === "spacer") {
    return (
      <FormInput
        label="高さ"
        description="4〜200px"
        name={`${block.id}-height`}
        type="number"
        min={4}
        max={200}
        value={block.height}
        onChange={(event) => onChange({ ...block, height: Number(event.target.value) || 24 })}
      />
    );
  }
  return <p className="text-sm text-muted-foreground">横罫線を表示します。</p>;
}

function EmailImageBlockEditor({
  block,
  onChange,
  pickerOpen,
  setPickerOpen,
}: {
  block: Extract<EmailLeafBlockV2, { type: "image" }>;
  onChange: (block: EmailLeafBlockV2) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}): ReactNode {
  return (
    <FieldGroup>
      <img
        src={assetRawUrl(block.source.assetId)}
        alt={block.alt}
        className="max-h-48 rounded-lg object-contain"
      />
      <FieldGroup className="sm:grid sm:grid-cols-2">
        <FormInput
          label="代替テキスト"
          name={`${block.id}-alt`}
          value={block.alt}
          onChange={(event) => onChange({ ...block, alt: event.target.value })}
        />
        <FormInput
          label="表示幅"
          name={`${block.id}-width`}
          type="number"
          min={40}
          max={720}
          value={block.width}
          onChange={(event) => onChange({ ...block, width: Number(event.target.value) || 552 })}
        />
      </FieldGroup>
      <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
        <ImageIcon data-icon="inline-start" />
        アセットを変更
      </Button>
      {pickerOpen ? (
        <Suspense fallback={null}>
          <AssetPickerDialog
            open
            onOpenChange={setPickerOpen}
            onSelect={(asset: AssetSummary) => {
              onChange({
                ...block,
                source: { kind: "asset", assetId: asset.id },
                alt: block.alt || asset.name,
              });
              setPickerOpen(false);
            }}
          />
        </Suspense>
      ) : null}
    </FieldGroup>
  );
}
