import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { PageLayout } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { SegmentRow } from "@openengage/core/segments";

import { segmentsQueryOptions } from "./segment-api";
import { SegmentFormDialog } from "./segment-form-dialog";

export function ListsPage(): ReactNode {
  const { formatDate } = useWorkspaceFormatters();
  const navigate = useNavigate();
  const { data: lists } = useSuspenseQuery(segmentsQueryOptions("static"));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SegmentRow | null>(null);

  const columns: DataTableColumn<SegmentRow>[] = [
    {
      key: "name",
      header: "リスト",
      sortValue: (list) => list.name.toLocaleLowerCase(),
      cell: (list) => (
        <Button
          variant="link"
          className="h-auto p-0"
          nativeButton={false}
          render={<Link to="/lists/$id" params={{ id: list.id }} />}
        >
          {list.name}
        </Button>
      ),
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "memberCount",
      header: "連絡先",
      sortValue: (list) => list.memberCount,
      cell: (list) => (
        <Button
          variant="link"
          className="h-auto p-0"
          nativeButton={false}
          render={<Link to="/lists/$id" params={{ id: list.id }} />}
        >
          {list.memberCount.toLocaleString()}
        </Button>
      ),
    },
    {
      key: "updatedAt",
      header: "更新日",
      sortValue: (list) => list.updatedAt,
      cell: (list) => formatDate(list.updatedAt),
      headClassName: "text-right",
      cellClassName: "text-right text-muted-foreground",
    },
    {
      key: "actions",
      header: <span className="sr-only">操作</span>,
      label: "操作",
      enableHiding: false,
      cell: (list) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${list.name}を編集`}
            onClick={() => {
              setEditing(list);
              setFormOpen(true);
            }}
          >
            <Pencil />
          </Button>
        </div>
      ),
      headClassName: "px-4",
      cellClassName: "px-4",
    },
  ];

  return (
    <PageLayout
      title="リスト"
      action={
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus data-icon="inline-start" />
          リストを作成
        </Button>
      }
    >
      <Card className="py-0">
        <CardContent className="px-0">
          <DataTable
            showColumnVisibility
            columns={columns}
            rows={lists}
            rowKey={(list) => list.id}
            caption="リスト一覧"
            emptyTitle="リストがまだありません"
            emptyDescription="展示会来場者やインポートした宛先など、手動で管理する最初のリストを作成しましょう。"
            emptyAction={
              <Button variant="outline" onClick={() => setFormOpen(true)}>
                <Plus data-icon="inline-start" />
                リストを作成
              </Button>
            }
          />
        </CardContent>
      </Card>
      <SegmentFormDialog
        key={`${editing?.id ?? "new"}-${formOpen}`}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        kind="static"
        onCreated={(id) => void navigate({ to: "/lists/$id", params: { id } })}
      />
    </PageLayout>
  );
}
