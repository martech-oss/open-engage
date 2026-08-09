import { Pencil } from "lucide-react";
import { type ReactNode } from "react";
import { toast } from "sonner";

import { ArchiveConfirm } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type EmailTemplateRow,
  useArchiveEmailTemplate,
  usePublishEmailTemplate,
} from "@/features/emails/email-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { formatDateTime } from "@/lib/format";

export function TemplateTable({
  items,
  loading,
  onEdit,
}: {
  items: EmailTemplateRow[];
  loading: boolean;
  onEdit: (template: EmailTemplateRow) => void;
}): ReactNode {
  const publishTemplate = usePublishEmailTemplate();
  const archiveTemplate = useArchiveEmailTemplate();

  async function publish(template: EmailTemplateRow) {
    try {
      await publishTemplate.mutateAsync({ id: template.id });
      toast.success("テンプレートを公開しました");
    } catch (caught) {
      toast.error(getErrorMessage(caught, "テンプレートを公開できませんでした"));
    }
  }

  async function archive(template: EmailTemplateRow) {
    try {
      await archiveTemplate.mutateAsync({ id: template.id });
      toast.success("テンプレートをアーカイブしました");
    } catch (caught) {
      toast.error(getErrorMessage(caught, "アーカイブできませんでした"));
    }
  }

  const columns: DataTableColumn<EmailTemplateRow>[] = [
    {
      key: "template",
      header: "テンプレート",
      cell: (template) => (
        <div className="flex min-w-48 flex-col gap-1">
          <span className="font-medium">{template.name}</span>
          <span className="text-xs text-muted-foreground">
            draft revision {template.draftRevision}
          </span>
        </div>
      ),
    },
    {
      key: "subject",
      header: "件名",
      cell: (template) => template.subject,
      cellClassName: "max-w-80 truncate",
    },
    {
      key: "purpose",
      header: "用途",
      cell: (template) => (
        <Badge variant="outline">
          {template.purpose === "transactional" ? "Transactional" : "Marketing"}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "公開状態",
      cell: (template) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant={template.publishedRevision ? "secondary" : "outline"}>
            {template.publishedRevision ? "公開済み" : "下書き"}
          </Badge>
          {template.purpose === "marketing" && template.publishedRevision ? (
            <Badge variant="outline">送信無効</Badge>
          ) : null}
          {template.hasUnpublishedChanges ? (
            <Badge variant="outline">未公開の変更あり</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "published",
      header: "公開日時",
      cell: (template) => (
        <div className="flex min-w-44 flex-col gap-1">
          <span>{template.publishedAt ? formatDateTime(template.publishedAt) : "未公開"}</span>
          <span className="text-xs text-muted-foreground">
            {template.publishedRevision
              ? `revision ${template.publishedRevision}`
              : template.purpose === "transactional"
                ? "Automationでは利用不可"
                : "送信機能は未提供"}
          </span>
        </div>
      ),
    },
    {
      key: "actions",
      header: "操作",
      cell: (template) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onEdit(template)}>
            <Pencil data-icon="inline-start" />
            編集
          </Button>
          <Button
            size="sm"
            onClick={() => void publish(template)}
            disabled={!template.hasUnpublishedChanges}
          >
            公開
          </Button>
          <ArchiveConfirm label={template.name} onConfirm={() => void archive(template)} />
        </div>
      ),
      headClassName: "text-right",
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border">
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(template) => template.id}
        caption="メールテンプレート一覧"
        loading={loading}
        skeletonRowCount={3}
        emptyTitle="テンプレートがありません"
        emptyDescription="AIまたは手動でメールテンプレートを作成してください。"
      />
    </div>
  );
}
