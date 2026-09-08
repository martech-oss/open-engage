import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ErrorAlert, FormInput, MetricCard, MetricGrid } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { useWorkspaceTime } from "@/lib/workspace-time";

import { programCohortQueryOptions } from "./program-api";
export function ProgramCohortPanel({ id }: { id: string }) {
  const { renderedAt } = useWorkspaceTime();
  const [from, setFrom] = useState("2000-01-01");
  const [to, setTo] = useState(
    new Date(Date.parse(renderedAt) + 86400000).toISOString().slice(0, 10),
  );
  const [asOf, setAsOf] = useState(renderedAt);
  const valid = Boolean(from && to && from < to && Number.isFinite(Date.parse(asOf)));
  const query = useQuery({
    ...programCohortQueryOptions(id, {
      from: `${from || "2000-01-01"}T00:00:00.000Z`,
      to: `${to || "2100-01-01"}T00:00:00.000Z`,
      asOf,
    }),
    enabled: valid,
  });
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold">参加日コホートの成果</h2>
        <p className="text-sm text-muted-foreground">
          期間内に参加した人を母数に、集計時点までの成果を表示します。訂正はその記録時点から反映します。売上配分やROIとは別の指標です。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <FormInput
          name="cohort-from"
          label="参加期間の開始（UTC・含む）"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <FormInput
          name="cohort-to"
          label="参加期間の終了（UTC・含まない）"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <FormInput
          name="cohort-asof"
          label="集計時点（ISO日時）"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
      </div>
      <Button variant="outline" onClick={() => setAsOf(new Date().toISOString())}>
        現在時点で再集計
      </Button>
      {!valid && <ErrorAlert>期間と集計日時を確認してください</ErrorAlert>}
      {query.error && <ErrorAlert>{query.error.message}</ErrorAlert>}
      {query.data && (
        <MetricGrid>
          <MetricCard label="コホート参加者" value={query.data.members} />
          <MetricCard label="成果人数" value={query.data.succeeded} />
          <MetricCard label="成果率" value={`${(query.data.rate * 100).toFixed(1)}%`} />
          <MetricCard
            label="初回成果までの平均"
            value={
              query.data.averageTimeToSuccessSeconds === null
                ? "—"
                : `${(query.data.averageTimeToSuccessSeconds / 86400).toFixed(2)}日`
            }
            description="成果を達成した参加者の平均"
          />
        </MetricGrid>
      )}
    </section>
  );
}
