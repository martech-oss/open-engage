import { useSuspenseQueries } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pencil, Plus, RefreshCw, Sparkles } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";

import { PageLayout } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { SegmentDefinition, SegmentRow } from "@openengage/core/segments";

import {
  segmentOptionsQueryOptions,
  segmentsQueryOptions,
  useCreateSegment,
  useRefreshSegment,
  useUpdateSegment,
} from "./segment-api";
import { evaluationLabel, toSegmentDefinition } from "./segment-bits";
import { SegmentFormDialog } from "./segment-form-dialog";

const SegmentAiSheet = lazy(async () => ({
  default: (await import("./segment-ai-sheet")).SegmentAiSheet,
}));

export function SegmentsPage(): ReactNode {
  const navigate = useNavigate();
  const [{ data: segments }, { data: catalog }] = useSuspenseQueries({
    queries: [segmentsQueryOptions("dynamic"), segmentOptionsQueryOptions()],
  });
  const createSegment = useCreateSegment();
  const updateSegment = useUpdateSegment();
  const refreshSegment = useRefreshSegment();
  const [manualOpen, setManualOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [editing, setEditing] = useState<SegmentRow | null>(null);

  async function applyAiDefinition(definition: SegmentDefinition): Promise<void> {
    if (editing) {
      await updateSegment.mutateAsync({ id: editing.id, ...definition });
    } else {
      const created = await createSegment.mutateAsync({
        name: definition.name,
        slug: definition.slug,
        description: definition.description,
        kind: definition.kind,
        ...(definition.filter ? { filter: definition.filter } : {}),
        membershipSource: definition.membershipSource,
      });
      await navigate({
        to: definition.kind === "static" ? "/lists/$id" : "/segments/$id",
        params: { id: created.id },
      });
    }
    setEditing(null);
  }

  const columns: DataTableColumn<SegmentRow>[] = [
    {
      key: "name",
      header: "セグメント",
      sortValue: (segment) => segment.name.toLocaleLowerCase(),
      cell: (segment) => (
        <Button
          variant="link"
          className="h-auto p-0"
          nativeButton={false}
          render={<Link to="/segments/$id" params={{ id: segment.id }} />}
        >
          {segment.name}
        </Button>
      ),
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "memberCount",
      header: "連絡先",
      sortValue: (segment) => segment.memberCount,
      cell: (segment) => (
        <Button
          variant="link"
          className="h-auto p-0"
          nativeButton={false}
          render={<Link to="/segments/$id" params={{ id: segment.id }} />}
        >
          {segment.memberCount.toLocaleString()}
        </Button>
      ),
    },
    {
      key: "status",
      header: "状態",
      sortValue: (segment) => evaluationLabel(segment),
      cell: (segment) => (
        <Badge variant={segment.evaluationStatus === "failed" ? "destructive" : "secondary"}>
          {evaluationLabel(segment)}
        </Badge>
      ),
    },
    {
      key: "updatedAt",
      header: "更新日",
      sortValue: (segment) => segment.evaluatedAt ?? segment.updatedAt,
      cell: (segment) => formatDate(segment.evaluatedAt ?? segment.updatedAt),
      headClassName: "text-right",
      cellClassName: "text-right text-muted-foreground",
    },
    {
      key: "actions",
      header: <span className="sr-only">操作</span>,
      label: "操作",
      enableHiding: false,
      cell: (segment) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={refreshSegment.isPending}
            aria-label={`${segment.name}を再評価`}
            onClick={() => void refreshSegment.mutateAsync({ id: segment.id })}
          >
            <RefreshCw />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${segment.name}をAIで編集`}
            onClick={() => {
              setEditing(segment);
              setAiOpen(true);
            }}
          >
            <Sparkles />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${segment.name}を編集`}
            onClick={() => {
              setEditing(segment);
              setManualOpen(true);
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
      title="セグメント"
      action={
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setEditing(null);
              setAiOpen(true);
            }}
          >
            <Sparkles data-icon="inline-start" />
            AIで作成
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setManualOpen(true);
            }}
          >
            <Plus data-icon="inline-start" />
            手動で作成
          </Button>
        </div>
      }
    >
      <Card className="py-0">
        <CardContent className="px-0">
          <DataTable
            showColumnVisibility
            columns={columns}
            rows={segments}
            rowKey={(segment) => segment.id}
            caption="セグメント一覧"
            emptyTitle="セグメントがまだありません"
            emptyDescription="条件に合う連絡先が自動で出入りする最初のセグメントを作成しましょう。"
            emptyAction={
              <Button variant="outline" onClick={() => setManualOpen(true)}>
                <Plus data-icon="inline-start" />
                手動で作成
              </Button>
            }
          />
        </CardContent>
      </Card>
      <SegmentFormDialog
        key={`${editing?.id ?? "new"}-${manualOpen}`}
        open={manualOpen}
        onOpenChange={(open) => {
          setManualOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        catalog={catalog}
        kind="dynamic"
        onCreated={(id) => void navigate({ to: "/segments/$id", params: { id } })}
      />
      <Suspense fallback={null}>
        {aiOpen ? (
          <SegmentAiSheet
            open
            onOpenChange={(open) => {
              setAiOpen(open);
              if (!open) setEditing(null);
            }}
            mode={editing ? "refine" : "create"}
            entityId={editing?.id ?? "new-segment"}
            {...(editing ? { currentDefinition: toSegmentDefinition(editing) } : {})}
            onApply={applyAiDefinition}
          />
        ) : null}
      </Suspense>
    </PageLayout>
  );
}
