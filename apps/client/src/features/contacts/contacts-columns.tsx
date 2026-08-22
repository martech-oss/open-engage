import { EllipsisVertical } from "lucide-react";

import type { DataTableColumn } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/format";
import type { ContactSummary } from "@openengage/core/contacts";

import { ContactAvatar, ContactScoreBadge, ContactStatusDot, contactName } from "./contact-bits";

/**
 * The dense contacts table from the design: identity, state and classification
 * are each folded into one column so the whole row fits in 44px without the
 * horizontal scroll the previous six-column layout needed.
 */
export function contactColumns({
  contacts,
  renderedAt,
  selected,
  onSelectedChange,
  onOpen,
  onArchive,
}: {
  contacts: ContactSummary[];
  renderedAt: string;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onOpen: (contact: ContactSummary) => void;
  onArchive: (contact: ContactSummary) => void;
}): DataTableColumn<ContactSummary>[] {
  const allVisibleSelected =
    contacts.length > 0 && contacts.every((contact) => selected.has(contact.id));

  return [
    {
      key: "select",
      enableHiding: false,
      header: (
        <Checkbox
          checked={allVisibleSelected}
          onCheckedChange={(checked) =>
            onSelectedChange(checked ? new Set(contacts.map((item) => item.id)) : new Set())
          }
          aria-label="表示中の連絡先をすべて選択"
        />
      ),
      cell: (contact) => (
        <Checkbox
          checked={selected.has(contact.id)}
          onCheckedChange={(checked) => {
            const next = new Set(selected);
            if (checked) next.add(contact.id);
            else next.delete(contact.id);
            onSelectedChange(next);
          }}
          onClick={(event) => event.stopPropagation()}
          aria-label={`${contactName(contact)}を選択`}
        />
      ),
      headClassName: "w-9 pl-3.5",
      cellClassName: "pl-3.5",
    },
    {
      key: "contact",
      header: "連絡先",
      sortValue: (contact) => contactName(contact).toLocaleLowerCase(),
      cell: (contact) => (
        <div className="flex items-center gap-2.5">
          <ContactAvatar contact={contact} tinted />
          <div className="min-w-0">
            <div className="truncate text-[12.5px] leading-tight font-medium">
              {contactName(contact)}
            </div>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">
              {contact.email ?? contact.phone ?? contact.externalId ?? "匿名Contact"}
            </div>
          </div>
        </div>
      ),
      headClassName: "min-w-56",
    },
    {
      key: "status",
      header: "状態・ステージ",
      sortValue: (contact) => `${contact.status} ${contact.stage}`,
      cell: (contact) => (
        <div className="flex items-center gap-2">
          <ContactStatusDot status={contact.status} />
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {contact.stage}
          </span>
        </div>
      ),
      headClassName: "w-40",
    },
    {
      key: "classification",
      header: "会社・タグ",
      sortValue: (contact) =>
        `${contact.companies[0]?.name ?? ""} ${contact.tags.map((tag) => tag.name).join(" ")}`,
      cell: (contact) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="max-w-32 truncate text-[11.5px]">
            {contact.companies[0]?.name ?? "—"}
          </span>
          {contact.tags.slice(0, 2).map((tag) => (
            <Badge key={tag.id} variant="secondary" className="shrink-0 gap-1">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </Badge>
          ))}
        </div>
      ),
      headClassName: "min-w-48",
      cellClassName: "max-w-72",
    },
    {
      key: "score",
      header: "スコア",
      sortValue: (contact) => contact.score,
      cell: (contact) => <ContactScoreBadge score={contact.score} />,
      headClassName: "w-20 text-right",
      cellClassName: "text-right",
    },
    {
      key: "updatedAt",
      header: "更新",
      sortValue: (contact) => contact.updatedAt,
      cell: (contact) => formatRelativeTime(contact.updatedAt, { now: renderedAt }),
      headClassName: "w-24 text-right",
      cellClassName: "text-right text-[11px] text-muted-foreground",
    },
    {
      key: "actions",
      enableHiding: false,
      header: "",
      cell: (contact) => (
        <DropdownMenu>
          {/* Stops the row's own click handler from opening the drawer behind the menu. */}
          <DropdownMenuTrigger
            onClick={(event) => event.stopPropagation()}
            render={
              <Button variant="ghost" size="icon-xs" aria-label={`${contactName(contact)}の操作`} />
            }
          >
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onOpen(contact)}>詳細を開く</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onArchive(contact)}>
                {contact.status === "archived" ? "復元" : "アーカイブ"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      headClassName: "w-10 pr-3.5",
      cellClassName: "pr-3.5",
    },
  ];
}
