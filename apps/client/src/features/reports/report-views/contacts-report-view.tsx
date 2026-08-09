import { Activity, TrendingUp, UserCheck, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, MetricGrid } from "@/components/app-ui";
import type { ContactsReport } from "@/features/reports/report-api";

import { RankingCard, TrendCard } from "../report-widgets";

export function ContactsReportView({ report }: { report: ContactsReport }): ReactNode {
  return (
    <>
      <MetricGrid className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="総連絡先" value={report.summary.totalContacts} icon={<UsersRound />} />
        <MetricCard label="アクティブ" value={report.summary.activeContacts} icon={<UserCheck />} />
        <MetricCard label="期間内の新規" value={report.summary.newContacts} icon={<TrendingUp />} />
        <MetricCard
          label="期間内のアーカイブ"
          value={report.summary.archivedContacts}
          icon={<Activity />}
        />
      </MetricGrid>
      <TrendCard
        title="連絡先の推移"
        description="期間内に追加・アーカイブされた連絡先"
        data={report.trend}
        series={[
          { key: "added", label: "追加", color: "var(--color-chart-1)" },
          { key: "archived", label: "アーカイブ", color: "var(--color-chart-2)" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <RankingCard
          title="上位セグメント"
          description="現在のアクティブ連絡先数"
          items={report.topSegments}
        />
        <RankingCard
          title="上位タグ"
          description="現在のアクティブ連絡先数"
          items={report.topTags}
        />
      </div>
    </>
  );
}
