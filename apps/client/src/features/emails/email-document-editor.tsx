import {
  ChevronDown,
  ChevronUp,
  ImageIcon,
  LinkIcon,
  Minus,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { FormInput, FormTextarea } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { assetRawUrl, type AssetSummary } from "@/features/assets/asset-api";
import { AssetPickerDialog } from "@/features/assets/asset-picker";
import type { EmailBlockV2, EmailDocumentV2, EmailLeafBlockV2 } from "@openengage/core/messaging";

export function EmailDocumentEditor({
  value,
  onChange,
}: {
  value: EmailDocumentV2;
  onChange: (value: EmailDocumentV2) => void;
}): ReactNode {
  const [addImagePickerOpen, setAddImagePickerOpen] = useState(false);
  function updateBlock(index: number, block: EmailBlockV2): void {
    onChange({
      ...value,
      blocks: value.blocks.map((current, i) => (i === index ? block : current)),
    });
  }

  function addBlock(type: "markdown" | "button" | "divider" | "spacer"): void {
    const id = crypto.randomUUID();
    const block: EmailBlockV2 =
      type === "markdown"
        ? { id, type, markdown: "本文を入力してください。" }
        : type === "button"
          ? {
              id,
              type,
              label: "詳しく見る",
              href: "https://example.com",
              variant: "primary",
              align: "center",
            }
          : type === "divider"
            ? { id, type }
            : { id, type, height: 24 };
    onChange({ ...value, blocks: [...value.blocks, block] });
  }

  function moveBlock(index: number, offset: -1 | 1): void {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= value.blocks.length) return;
    const blocks = [...value.blocks];
    const current = blocks[index];
    const target = blocks[nextIndex];
    if (!current || !target) return;
    blocks[index] = target;
    blocks[nextIndex] = current;
    onChange({ ...value, blocks });
  }

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

      <Card size="sm">
        <CardHeader>
          <CardTitle>メールテーマ</CardTitle>
          <CardDescription>メール本文に保存されるデザイン設定です。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="sm:grid sm:grid-cols-2">
            <ColorField
              id="email-background-color"
              label="背景色"
              value={value.theme.backgroundColor}
              onChange={(backgroundColor) =>
                onChange({ ...value, theme: { ...value.theme, backgroundColor } })
              }
            />
            <ColorField
              id="email-surface-color"
              label="本文背景色"
              value={value.theme.surfaceColor}
              onChange={(surfaceColor) =>
                onChange({ ...value, theme: { ...value.theme, surfaceColor } })
              }
            />
            <ColorField
              id="email-text-color"
              label="本文色"
              value={value.theme.textColor}
              onChange={(textColor) => onChange({ ...value, theme: { ...value.theme, textColor } })}
            />
            <ColorField
              id="email-accent-color"
              label="アクセント色"
              value={value.theme.accentColor}
              onChange={(accentColor) =>
                onChange({ ...value, theme: { ...value.theme, accentColor } })
              }
            />
            <Field>
              <FieldLabel>フォント</FieldLabel>
              <ToggleGroup
                value={[value.theme.fontFamily]}
                onValueChange={(next) => {
                  const fontFamily = next[0] as EmailDocumentV2["theme"]["fontFamily"] | undefined;
                  if (fontFamily) onChange({ ...value, theme: { ...value.theme, fontFamily } });
                }}
                variant="outline"
                spacing={0}
              >
                <ToggleGroupItem value="sans">Sans</ToggleGroupItem>
                <ToggleGroupItem value="serif">Serif</ToggleGroupItem>
                <ToggleGroupItem value="mono">Mono</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <FormInput
              label="本文幅"
              name="emailWidth"
              type="number"
              min={320}
              max={720}
              value={value.theme.width}
              onChange={(event) =>
                onChange({
                  ...value,
                  theme: { ...value.theme, width: Number(event.target.value) || 600 },
                })
              }
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">コンテンツ</p>
          <p className="text-sm text-muted-foreground">ブロック単位で安全に編集できます。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => addBlock("markdown")}>
            <Type data-icon="inline-start" />
            本文
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addBlock("button")}>
            <LinkIcon data-icon="inline-start" />
            ボタン
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAddImagePickerOpen(true)}
          >
            <ImageIcon data-icon="inline-start" />
            画像
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addBlock("divider")}>
            <Minus data-icon="inline-start" />
            区切り
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addBlock("spacer")}>
            <Plus data-icon="inline-start" />
            余白
          </Button>
        </div>
      </div>

      <ItemGroup>
        {value.blocks.map((block, index) => (
          <Item key={block.id} variant="outline" className="items-start">
            <ItemContent className="min-w-0 gap-3">
              <ItemTitle>
                <Badge variant="secondary">{blockLabel(block.type)}</Badge>
              </ItemTitle>
              <BlockFields block={block} onChange={(next) => updateBlock(index, next)} />
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="上へ移動"
                disabled={index === 0}
                onClick={() => moveBlock(index, -1)}
              >
                <ChevronUp />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="下へ移動"
                disabled={index === value.blocks.length - 1}
                onClick={() => moveBlock(index, 1)}
              >
                <ChevronDown />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="ブロックを削除"
                disabled={value.blocks.length === 1}
                onClick={() =>
                  onChange({ ...value, blocks: value.blocks.filter((_, i) => i !== index) })
                }
              >
                <Trash2 />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <AssetPickerDialog
        open={addImagePickerOpen}
        onOpenChange={setAddImagePickerOpen}
        onSelect={(asset) => {
          onChange({
            ...value,
            blocks: [
              ...value.blocks,
              {
                id: crypto.randomUUID(),
                type: "image",
                source: { kind: "asset", assetId: asset.id },
                alt: asset.name,
                width: Math.min(value.theme.width - 48, 672),
                align: "center",
              },
            ],
          });
          setAddImagePickerOpen(false);
        }}
      />
    </div>
  );
}

function BlockFields({
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
              <LeafBlockFields
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
            <LeafBlockFields
              key={child.id}
              block={child}
              onChange={(next) =>
                onChange({
                  ...block,
                  blocks: block.blocks.map((current, i) => (i === index ? next : current)),
                })
              }
            />
          ))}
        </div>
      </FieldGroup>
    );
  }
  return <LeafBlockFields block={block} onChange={onChange} />;
}

function LeafBlockFields({
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
  if (block.type === "image") {
    const src = assetRawUrl(block.source.assetId);
    return (
      <FieldGroup>
        <img src={src} alt={block.alt} className="max-h-48 rounded-lg object-contain" />
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
        <AssetPickerDialog
          open={pickerOpen}
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
      </FieldGroup>
    );
  }
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

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="color"
          value={value}
          className="w-14 px-1"
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          value={value}
          pattern="#[0-9A-Fa-f]{6}"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <FieldDescription>HEXカラー</FieldDescription>
    </Field>
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
