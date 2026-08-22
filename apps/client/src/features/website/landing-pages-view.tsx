import { ExternalLink, FileStack, Globe2, Pencil } from "lucide-react";
import type { ReactNode } from "react";

import { ArchiveConfirm, CopyButton, MetricCard, MetricGrid } from "@/components/app-ui";
import type { DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";

import { summarizeLandingPages } from "./resource-model";
import type { LandingPageRow } from "./website-api";
import { PublishStatusBadge } from "./website-shared";

export function landingPageColumns({
  workspaceSlug,
  formatDateTime,
  onEdit,
  onArchive,
}: {
  workspaceSlug: string;
  formatDateTime: (value: string) => string;
  onEdit: (item: LandingPageRow) => void;
  onArchive: (item: LandingPageRow) => Promise<void>;
}): DataTableColumn<LandingPageRow>[] {
  return [
    {
      key: "name",
      header: "名前",
      cell: (item) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">/{item.slug}</span>
        </div>
      ),
    },
    { key: "status", header: "状態", cell: (item) => <PublishStatusBadge status={item.status} /> },
    { key: "version", header: "バージョン", cell: (item) => `v${item.version}` },
    { key: "updatedAt", header: "更新日時", cell: (item) => formatDateTime(item.updatedAt) },
    {
      key: "actions",
      header: "操作",
      cell: (item) => {
        const url = `${window.location.origin}/p/${workspaceSlug}/${item.slug}`;
        return (
          <div className="flex justify-end gap-1">
            <CopyButton value={url} label="URL" />
            {item.status === "published" ? (
              <Button
                size="sm"
                variant="outline"
                render={
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${item.name}を表示`}
                  />
                }
              >
                <ExternalLink data-icon="inline-start" />
                表示
              </Button>
            ) : null}
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
        );
      },
      headClassName: "text-right",
    },
  ];
}

export function LandingPagesSummary({ items }: { items: LandingPageRow[] }): ReactNode {
  const summary = summarizeLandingPages(items);
  const cards = [
    { label: "ページ", value: summary.total, description: "現在のページ数", icon: FileStack },
    { label: "公開中", value: summary.published, description: "公開URLから閲覧可能", icon: Globe2 },
    {
      label: "最新バージョン",
      value: summary.latestVersion,
      description: "保存履歴の最大値",
      icon: Pencil,
    },
  ];
  return (
    <MetricGrid className="sm:grid-cols-3">
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
