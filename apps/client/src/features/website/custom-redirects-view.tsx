import { Link as LinkIcon, MousePointerClick, Pencil } from "lucide-react";
import type { ReactNode } from "react";

import { ArchiveConfirm, CopyButton, MetricCard, MetricGrid } from "@/components/app-ui";
import type { DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";

import { summarizeCustomRedirects } from "./resource-model";
import type { CustomRedirectRow } from "./website-api";

export function customRedirectColumns({
  formatDateTime,
  onEdit,
  onArchive,
  publicUrl,
}: {
  formatDateTime: (value: string) => string;
  onEdit: (item: CustomRedirectRow) => void;
  onArchive: (item: CustomRedirectRow) => Promise<void>;
  publicUrl: (item: CustomRedirectRow) => string;
}): DataTableColumn<CustomRedirectRow>[] {
  return [
    {
      key: "name",
      header: "名前",
      cell: (item) => (
        <div className="flex max-w-80 flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="truncate text-xs text-muted-foreground">{item.destinationUrl}</span>
        </div>
      ),
    },
    {
      key: "url",
      header: "計測用URL",
      cell: (item) => {
        const url = publicUrl(item);
        return (
          <div className="flex items-center gap-1">
            <code className="max-w-72 truncate text-xs">{url}</code>
            <CopyButton value={url} label="コピー" />
          </div>
        );
      },
    },
    {
      key: "clicks",
      header: "クリック",
      cell: (item) => item.clickCount.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right",
    },
    { key: "updatedAt", header: "更新日時", cell: (item) => formatDateTime(item.updatedAt) },
    {
      key: "actions",
      header: "操作",
      cell: (item) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${item.name}を編集`}
            onClick={() => onEdit(item)}
          >
            <Pencil />
          </Button>
          <ArchiveConfirm
            label={item.name}
            description={`「${item.name}」の計測用URLは404を返すようになります。公開済みのリンクがないか確認してください。`}
            onConfirm={() => onArchive(item)}
          />
        </div>
      ),
      headClassName: "text-right",
    },
  ];
}

export function CustomRedirectsSummary({ items }: { items: CustomRedirectRow[] }): ReactNode {
  const summary = summarizeCustomRedirects(items);
  const cards = [
    {
      label: "リンク",
      value: summary.total.toLocaleString(),
      description: "有効な計測用リンク",
      icon: LinkIcon,
    },
    {
      label: "総クリック",
      value: summary.clicks.toLocaleString(),
      description: "匿名クリックを含みます",
      icon: MousePointerClick,
    },
  ];
  return (
    <MetricGrid>
      {cards.map((card) => (
        <MetricCard
          key={card.label}
          label={card.label}
          value={card.value}
          description={
            <div className="flex items-center gap-2 text-sm">
              <card.icon />
              {card.description}
            </div>
          }
        />
      ))}
    </MetricGrid>
  );
}
