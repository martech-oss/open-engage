import { Filter, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import type { SegmentOption } from "@/features/contacts/contact-api";
import type { ContactProfile } from "@openengage/core/contacts";

import { ControlledSelect, Section } from "./contact-bits";

export function RelationEditor({
  title,
  icon,
  items,
  options,
  disabled,
  onAdd,
  onRemove,
}: {
  title: string;
  icon: ReactNode;
  items: Array<{ id: string; name: string; color: string }>;
  options: Array<{ id: string; name: string; color: string }>;
  disabled: boolean;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}): ReactNode {
  const [selectedId, setSelectedId] = useState("");
  const assigned = new Set(items.map((item) => item.id));
  return (
    <Section title={title} icon={icon}>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge key={item.id} variant="outline" className="gap-1">
            <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.name}
            {!disabled && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void onRemove(item.id)}
                aria-label={`${item.name}を削除`}
              >
                <X />
              </Button>
            )}
          </Badge>
        ))}
        {items.length === 0 && <span className="text-sm text-muted-foreground">未設定</span>}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <ControlledSelect
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder={`追加する${title}を選択`}
            className="flex-1"
            options={options
              .filter((item) => !assigned.has(item.id))
              .map((item) => ({ value: item.id, label: item.name }))}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              void onAdd(selectedId).then(() => setSelectedId(""));
            }}
          >
            追加
          </Button>
        </div>
      )}
    </Section>
  );
}

export function SegmentEditor({
  profile,
  options,
  disabled,
  onAdd,
  onRemove,
}: {
  profile: ContactProfile;
  options: SegmentOption[];
  disabled: boolean;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}): ReactNode {
  const [selectedId, setSelectedId] = useState("");
  const assigned = new Set(profile.segments.map((segment) => segment.id));
  return (
    <Section title="リスト / セグメント" icon={<Filter className="size-4" />}>
      <ItemGroup>
        {profile.segments.map((segment) => (
          <Item key={segment.id} variant="muted" size="sm">
            <ItemContent>
              <ItemTitle>{segment.name}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Badge variant="outline">{segment.kind === "static" ? "リスト" : "セグメント"}</Badge>
              {!disabled && segment.source === "static" && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void onRemove(segment.id)}
                  aria-label={`${segment.name}から削除`}
                >
                  <X />
                </Button>
              )}
            </ItemActions>
          </Item>
        ))}
        {profile.segments.length === 0 && (
          <span className="text-sm text-muted-foreground">未所属</span>
        )}
      </ItemGroup>
      {!disabled && (
        <div className="flex gap-2">
          <ControlledSelect
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder="リストを選択"
            className="flex-1"
            options={options
              .filter((segment) => segment.kind === "static" && !assigned.has(segment.id))
              .map((segment) => ({ value: segment.id, label: segment.name }))}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              void onAdd(selectedId).then(() => setSelectedId(""));
            }}
          >
            追加
          </Button>
        </div>
      )}
    </Section>
  );
}
