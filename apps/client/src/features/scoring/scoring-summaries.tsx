import { Gauge, Tag as TagIcon, Target } from "lucide-react";
import type { ReactNode } from "react";

import { MetricCard, MetricGrid } from "@/components/app-ui";

export function ScoringRulesSummary({
  summary,
}: {
  summary: { total: number; enabled: number; pageActions: number; categories: number };
}): ReactNode {
  return (
    <MetricGrid>
      <MetricCard
        label="ルール"
        value={summary.total.toLocaleString()}
        description={<MetricDescription icon={<Gauge />} text={`有効 ${summary.enabled} 件`} />}
      />
      <MetricCard
        label="Page Action"
        value={summary.pageActions.toLocaleString()}
        description={<MetricDescription icon={<Target />} text="ページ閲覧を条件にしたルール" />}
      />
      <MetricCard
        label="カテゴリ"
        value={summary.categories.toLocaleString()}
        description={<MetricDescription icon={<TagIcon />} text="製品・関心別のスコア軸" />}
      />
    </MetricGrid>
  );
}

function MetricDescription({ icon, text }: { icon: ReactNode; text: string }): ReactNode {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      {text}
    </div>
  );
}
