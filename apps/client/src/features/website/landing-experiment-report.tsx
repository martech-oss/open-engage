import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { FormInput } from "@/components/app-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { getFormString } from "@/lib/form-data";
import { formatIsoDate } from "@/lib/format";
import { useWorkspaceTime, useWorkspaceFormatters } from "@/lib/workspace-time";
import type { Experiment } from "@openengage/core/web";

import { experimentReportQueryOptions } from "./optimization-api";
export function LandingExperimentReport({ experiment }: { experiment: Experiment }) {
  const { formatDateTime } = useWorkspaceFormatters();
  const { timeZone, renderedAt } = useWorkspaceTime();
  const today = formatIsoDate(new Date(renderedAt), timeZone);
  const [range, setRange] = useState({
    from: formatIsoDate(new Date(experiment.startedAt ?? experiment.createdAt), timeZone),
    to: today,
  });
  const { data, error } = useQuery(experimentReportQueryOptions({ id: experiment.id, ...range }));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setRange({ from: getFormString(form, "from"), to: getFormString(form, "to") });
  }
  const rows = data?.variants ?? [];
  type Row = (typeof rows)[number];
  const columns: DataTableColumn<Row>[] = [
    { key: "name", header: "案", cell: (row) => row.name },
    { key: "visitors", header: "表示した訪問者", cell: (row) => row.visitors },
    { key: "conversions", header: "送信成功", cell: (row) => row.conversions },
    { key: "conversionRate", header: "到達率", cell: (row) => `${row.conversionRate}%` },
    { key: "pendingVisitors", header: "30日間の計測中", cell: (row) => row.pendingVisitors },
  ];
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <FormInput
          label="初回表示の開始日"
          name="from"
          type="date"
          defaultValue={range.from}
          required
        />
        <FormInput
          label="初回表示の終了日"
          name="to"
          type="date"
          defaultValue={range.to}
          required
        />
        <Button type="submit" variant="outline">
          表示日で絞り込み
        </Button>
      </form>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.variantId}
        caption="ページ案の比較結果"
        emptyTitle="まだ表示が記録されていません"
      />
      {data ? (
        <p className="text-xs text-muted-foreground">
          集計時点: {formatDateTime(data.asOf)}
          。計測中の訪問者は今後の送信成功が加算されます。表示・送信とも訪問者ごとに1回です。
        </p>
      ) : null}
      {error ? <p role="alert">{error.message}</p> : null}
    </div>
  );
}
