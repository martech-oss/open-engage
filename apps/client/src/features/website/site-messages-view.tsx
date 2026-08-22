import { Eye, Link as LinkIcon, MessageSquareText, MousePointerClick, Pencil } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, MetricGrid } from "@/components/app-ui";
import { ArchiveConfirm } from "@/components/app-ui/dialogs";
import type { DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";

import { summarizeSiteMessages } from "./resource-model";
import type { SiteMessageRow } from "./website-api";
import { PublishStatusBadge } from "./website-shared";

export function siteMessageColumns({
  formatDateTime,
  onEdit,
  onArchive,
}: {
  formatDateTime: (value: string) => string;
  onEdit: (item: SiteMessageRow) => void;
  onArchive: (item: SiteMessageRow) => Promise<void>;
}): DataTableColumn<SiteMessageRow>[] {
  return [
    {
      key: "name",
      header: "名前",
      cell: (item) => (
        <div className="flex max-w-80 flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="truncate text-xs text-muted-foreground">{item.headline}</span>
        </div>
      ),
    },
    { key: "status", header: "状態", cell: (item) => <PublishStatusBadge status={item.status} /> },
    {
      key: "pagePattern",
      header: "ページ条件",
      cell: (item) => <code className="text-xs">{item.pagePattern}</code>,
    },
    {
      key: "impressions",
      header: "表示",
      cell: (item) => item.impressionCount.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right",
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
            description={`「${item.name}」は公開を終了し、通常の一覧から非表示になります。`}
            onConfirm={() => onArchive(item)}
          />
        </div>
      ),
      headClassName: "text-right",
    },
  ];
}

export function SiteMessagesSummary({ items }: { items: SiteMessageRow[] }): ReactNode {
  const summary = summarizeSiteMessages(items);
  const cards = [
    {
      label: "メッセージ",
      value: summary.total.toLocaleString(),
      description: "現在のメッセージ数",
      icon: MessageSquareText,
    },
    {
      label: "公開中",
      value: summary.published.toLocaleString(),
      description: "配信条件の評価対象",
      icon: LinkIcon,
    },
    {
      label: "表示",
      value: summary.impressions.toLocaleString(),
      description: "識別済み連絡先への表示",
      icon: Eye,
    },
    {
      label: "クリック率",
      value: `${summary.clickRate.toFixed(1)}%`,
      description: `${summary.clicks.toLocaleString()}クリック`,
      icon: MousePointerClick,
    },
  ];
  return (
    <MetricGrid>
      {cards.map((item) => (
        <MetricCard
          key={item.label}
          label={item.label}
          value={item.value}
          description={
            <div className="flex items-center gap-2 text-sm">
              <item.icon />
              {item.description}
            </div>
          }
        />
      ))}
    </MetricGrid>
  );
}
