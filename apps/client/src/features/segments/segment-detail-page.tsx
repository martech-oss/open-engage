import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil, RefreshCw, Sparkles, Users } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";

import { PageLayout } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CONTACTS_PAGE_SIZE,
  contactSearchDefaults,
  contactsQueryOptions,
} from "@/features/contacts/contact-api";
import { contactName } from "@/features/contacts/contact-bits";
import { useCursorPagination } from "@/hooks/use-cursor-pagination";
import { formatDate } from "@/lib/format";
import type { ContactSummary } from "@openengage/core/contacts";

import {
  segmentOptionsQueryOptions,
  segmentQueryOptions,
  useRefreshSegment,
  useUpdateSegment,
} from "./segment-api";
import { evaluationLabel, toSegmentDefinition } from "./segment-bits";
import { SegmentFilterSummary } from "./segment-filter-summary";
import { SegmentFormDialog } from "./segment-form-dialog";

const SegmentAiSheet = lazy(async () => ({
  default: (await import("./segment-ai-sheet")).SegmentAiSheet,
}));

export function SegmentDetailPage({ segmentId }: { segmentId: string }): ReactNode {
  const { data: segment } = useSuspenseQuery(segmentQueryOptions(segmentId));
  const { data: catalog } = useSuspenseQuery(segmentOptionsQueryOptions());
  const updateSegment = useUpdateSegment();
  const refreshSegment = useRefreshSegment();
  const [editOpen, setEditOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const memberSearch = {
    ...contactSearchDefaults,
    segmentId,
    status: "all" as const,
  };
  const {
    cursor,
    hasPreviousPage,
    goToNextPage: goToNextCursor,
    goToPreviousPage: goToPreviousCursor,
  } = useCursorPagination(segmentId);
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => {
    setPageIndex(0);
  }, [segmentId]);
  const membersQuery = useQuery(contactsQueryOptions(memberSearch, cursor));
  const members = membersQuery.data?.items ?? [];
  const total = membersQuery.data?.total ?? segment.memberCount;
  const nextCursor = membersQuery.data?.nextCursor;
  const firstRow = members.length === 0 ? 0 : pageIndex * CONTACTS_PAGE_SIZE + 1;
  const lastRow = pageIndex * CONTACTS_PAGE_SIZE + members.length;

  const columns: DataTableColumn<ContactSummary>[] = [
    {
      key: "contact",
      header: "連絡先",
      sortValue: (contact) => contactName(contact).toLocaleLowerCase(),
      cell: (contact) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{contactName(contact)}</span>
          <span className="text-xs text-muted-foreground">
            {contact.email ?? contact.phone ?? contact.externalId ?? "識別子なし"}
          </span>
        </div>
      ),
      headClassName: "px-4",
      cellClassName: "px-4",
    },
    {
      key: "stage",
      header: "ステージ",
      sortValue: (contact) => contact.stage,
      cell: (contact) => <Badge variant="secondary">{contact.stage}</Badge>,
    },
    {
      key: "score",
      header: "スコア",
      sortValue: (contact) => contact.score,
      cell: (contact) => contact.score,
      cellClassName: "tabular-nums",
    },
    {
      key: "updatedAt",
      header: "更新日",
      sortValue: (contact) => contact.updatedAt,
      cell: (contact) => formatDate(contact.updatedAt),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right text-muted-foreground",
    },
  ];

  return (
    <PageLayout
      title={segment.name}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/segments" />}>
            <ArrowLeft data-icon="inline-start" />
            一覧
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link to="/contacts" search={{ ...contactSearchDefaults, segmentId: segment.id }} />
            }
          >
            <Users data-icon="inline-start" />
            連絡先で管理
          </Button>
          <Button
            variant="outline"
            disabled={refreshSegment.isPending}
            onClick={() => void refreshSegment.mutateAsync({ id: segment.id })}
          >
            <RefreshCw data-icon="inline-start" />
            再評価
          </Button>
          <Button variant="outline" onClick={() => setAiOpen(true)}>
            <Sparkles data-icon="inline-start" />
            AIで編集
          </Button>
          <Button onClick={() => setEditOpen(true)}>
            <Pencil data-icon="inline-start" />
            編集
          </Button>
        </div>
      }
    >
      {segment.evaluationStatus === "failed" && segment.evaluationError ? (
        <Alert variant="destructive">
          <AlertTitle>再評価に失敗しました</AlertTitle>
          <AlertDescription>{segment.evaluationError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard label="連絡先" value={`${segment.memberCount.toLocaleString()}人`} tabular />
        <SummaryCard
          label="状態"
          value={evaluationLabel(segment)}
          badgeVariant={segment.evaluationStatus === "failed" ? "destructive" : "secondary"}
        />
        <SummaryCard label="更新日" value={formatDate(segment.evaluatedAt ?? segment.updatedAt)} />
      </div>
      <Card>
        <CardHeader>
          <CardDescription>スラッグ</CardDescription>
          <CardTitle className="font-mono text-base font-medium">{segment.slug}</CardTitle>
          {segment.description ? (
            <p className="text-sm text-muted-foreground">{segment.description}</p>
          ) : null}
        </CardHeader>
      </Card>
      {segment.filterAst ? (
        <Card>
          <CardHeader>
            <CardDescription>オーディエンス条件</CardDescription>
          </CardHeader>
          <CardContent>
            <SegmentFilterSummary filter={segment.filterAst} catalog={catalog} />
          </CardContent>
        </Card>
      ) : null}
      <Card className="py-0">
        <CardContent className="px-0">
          <DataTable
            showColumnVisibility
            columns={columns}
            rows={members}
            rowKey={(contact) => contact.id}
            caption={`${segment.name}のメンバー`}
            loading={membersQuery.isFetching}
            emptyTitle="メンバーがいません"
            emptyDescription="条件に一致する連絡先がまだありません。"
            emptyAction={
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    to="/contacts"
                    search={{ ...contactSearchDefaults, segmentId: segment.id }}
                  />
                }
              >
                <Users data-icon="inline-start" />
                連絡先で管理
              </Button>
            }
            pagination={{
              hasNextPage: Boolean(nextCursor),
              hasPreviousPage,
              onNext: () => {
                goToNextCursor(nextCursor);
                setPageIndex((index) => index + 1);
              },
              onPrevious: () => {
                goToPreviousCursor();
                setPageIndex((index) => Math.max(0, index - 1));
              },
              rangeLabel: `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} / ${total.toLocaleString()} 件`,
            }}
          />
        </CardContent>
      </Card>
      <SegmentFormDialog
        key={`${segment.id}-${editOpen}`}
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={segment}
        catalog={catalog}
        kind="dynamic"
      />
      <Suspense fallback={null}>
        {aiOpen ? (
          <SegmentAiSheet
            open
            onOpenChange={setAiOpen}
            mode="refine"
            entityId={segment.id}
            currentDefinition={toSegmentDefinition(segment)}
            onApply={async (definition) => {
              await updateSegment.mutateAsync({ id: segment.id, ...definition });
              setAiOpen(false);
            }}
          />
        ) : null}
      </Suspense>
    </PageLayout>
  );
}

function SummaryCard({
  label,
  value,
  tabular = false,
  badgeVariant,
}: {
  label: string;
  value: string;
  tabular?: boolean;
  badgeVariant?: "secondary" | "destructive";
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        {badgeVariant ? (
          <CardTitle>
            <Badge variant={badgeVariant}>{value}</Badge>
          </CardTitle>
        ) : (
          <CardTitle className={tabular ? "text-3xl tabular-nums" : undefined}>{value}</CardTitle>
        )}
      </CardHeader>
    </Card>
  );
}
