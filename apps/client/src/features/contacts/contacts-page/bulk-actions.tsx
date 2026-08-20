import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import type { ContactOptions } from "../contact-api";
import type { BulkAction } from "../contact-bits";
import { ControlledSelect } from "../contact-bits";
import { BulkActionBar } from "../contacts-toolbar";
import { BULK_ACTIONS, type BulkActionDefinition } from "./model";

export function ContactBulkActions({
  count,
  options,
  activeAction,
  resourceId,
  busy,
  onClear,
  onChooseAction,
  onResourceChange,
  onApply,
}: {
  count: number;
  options: ContactOptions;
  activeAction: BulkAction | null;
  resourceId: string;
  busy: boolean;
  onClear: () => void;
  onChooseAction: (definition: BulkActionDefinition) => void;
  onResourceChange: (resourceId: string) => void;
  onApply: () => void;
}): ReactNode {
  if (count === 0) return null;
  return (
    <BulkActionBar count={count} onClear={onClear}>
      {BULK_ACTIONS.map((item) => (
        <Button
          key={item.action}
          variant={activeAction === item.action ? "secondary" : "ghost"}
          size="sm"
          disabled={busy}
          onClick={() => onChooseAction(item)}
        >
          {item.label}
        </Button>
      ))}
      {activeAction === "add_tag" ? (
        <ControlledSelect
          value={resourceId}
          onValueChange={onResourceChange}
          placeholder="タグを選択"
          options={options.tags.map((tag) => ({ value: tag.id, label: tag.name }))}
        />
      ) : null}
      {activeAction === "add_segment" ? (
        <ControlledSelect
          value={resourceId}
          onValueChange={onResourceChange}
          placeholder="リストを選択"
          options={options.segments
            .filter((segment) => segment.kind === "static")
            .map((segment) => ({ value: segment.id, label: segment.name }))}
        />
      ) : null}
      {activeAction ? (
        <Button size="sm" disabled={busy} onClick={onApply}>
          適用
        </Button>
      ) : null}
    </BulkActionBar>
  );
}
