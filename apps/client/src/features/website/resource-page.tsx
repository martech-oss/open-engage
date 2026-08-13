import { Plus } from "lucide-react";
import type { ReactNode } from "react";

import { PageLayout } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Landing pages, signup forms, and site messages all render the same shell
 * (title + create button, banner?, summary cards, a list card wrapping
 * DataTable, an editor dialog) around genuinely different columns/summary/
 * editor content — this factors out only the shell, not the differences.
 */
export function WebsiteResourceListPage<Row>({
  title,
  createLabel,
  onCreateClick,
  banner,
  summary,
  listTitle,
  listDescription,
  columns,
  rows,
  rowKey,
  tableCaption,
  emptyTitle,
  emptyDescription,
  editor,
}: {
  title: string;
  createLabel: string;
  onCreateClick: () => void;
  banner?: ReactNode;
  summary: ReactNode;
  listTitle: string;
  listDescription?: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  tableCaption: string;
  emptyTitle: string;
  emptyDescription: string;
  editor: ReactNode;
}): ReactNode {
  return (
    <PageLayout
      title={title}
      action={
        <Button onClick={onCreateClick}>
          <Plus data-icon="inline-start" />
          {createLabel}
        </Button>
      }
    >
      {banner}
      {summary}
      <Card>
        <CardHeader>
          <CardTitle>{listTitle}</CardTitle>
          {listDescription ? <CardDescription>{listDescription}</CardDescription> : null}
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={rowKey}
            caption={tableCaption}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          />
        </CardContent>
      </Card>
      {editor}
    </PageLayout>
  );
}
