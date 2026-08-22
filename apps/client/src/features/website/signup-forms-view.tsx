import { Code2, ExternalLink, Pencil, Rows3 } from "lucide-react";
import type { ReactNode } from "react";

import { ArchiveConfirm, CopyButton, MetricCard, MetricGrid } from "@/components/app-ui";
import type { DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";

import { summarizeSignupForms } from "./resource-model";
import type { SignupFormRow } from "./website-api";
import { PublishStatusBadge } from "./website-shared";

export function signupFormColumns({
  formatDateTime,
  onEdit,
  onArchive,
  publicUrls,
}: {
  formatDateTime: (value: string) => string;
  onEdit: (item: SignupFormRow) => void;
  onArchive: (item: SignupFormRow) => Promise<void>;
  publicUrls: (item: SignupFormRow) => { page: string; embed: string };
}): DataTableColumn<SignupFormRow>[] {
  return [
    {
      key: "name",
      header: "名前",
      cell: (item) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">
            /{item.slug} · v{item.version}
          </span>
        </div>
      ),
    },
    { key: "status", header: "状態", cell: (item) => <PublishStatusBadge status={item.status} /> },
    { key: "style", header: "形式", cell: (item) => formStyleLabel(item.definition.style) },
    {
      key: "submissions",
      header: "送信",
      cell: (item) => item.submissionCount.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right",
    },
    { key: "updatedAt", header: "更新日時", cell: (item) => formatDateTime(item.updatedAt) },
    {
      key: "actions",
      header: "操作",
      cell: (item) => {
        const urls = publicUrls(item);
        const embedCode = `<script async src="${urls.embed}"></script>`;
        return (
          <div className="flex justify-end gap-1">
            <CopyButton value={embedCode} label="埋め込み" />
            {item.status === "published" ? (
              <Button
                size="sm"
                variant="outline"
                render={
                  <a
                    href={urls.page}
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

export function SignupFormsSummary({ items }: { items: SignupFormRow[] }): ReactNode {
  const summary = summarizeSignupForms(items);
  const cards = [
    { label: "フォーム", value: summary.total, description: "現在のフォーム数", icon: Rows3 },
    {
      label: "公開中",
      value: summary.published,
      description: "訪問者が送信可能",
      icon: ExternalLink,
    },
    {
      label: "累計送信",
      value: summary.submissions,
      description: "フォーム送信の合計",
      icon: Code2,
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

function formStyleLabel(style?: SignupFormRow["definition"]["style"]): string {
  return (
    {
      inline: "インライン",
      "floating-bar": "フローティングバー",
      "floating-box": "フローティングボックス",
      modal: "モーダル",
    }[style ?? "inline"] ?? "インライン"
  );
}
