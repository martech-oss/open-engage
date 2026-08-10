import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ProjectBriefDetail,
  ProjectBriefMutation,
  ProjectBriefStatus,
} from "@openengage/core/projects";

export function BriefStatus({ status }: { status: ProjectBriefStatus }): ReactNode {
  return (
    <Badge
      variant={
        status === "approved" ? "default" : status === "pending_approval" ? "secondary" : "outline"
      }
    >
      {
        (
          {
            draft: "下書き",
            pending_approval: "承認待ち",
            approved: "承認済み",
            completed: "終了",
          } as const
        )[status]
      }
    </Badge>
  );
}

export function BriefSection({
  title,
  rows,
}: {
  title: string;
  rows: [string, string][];
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={`${label}:${value}`}>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-sm whitespace-pre-line">{value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function mutationFromDetail(detail: ProjectBriefDetail): ProjectBriefMutation {
  return {
    name: detail.project.name,
    description: detail.project.description,
    color: detail.project.color,
    ownerUserId: detail.project.ownerUserId,
    approverUserId: detail.project.approverUserId,
    primaryMotion: detail.project.primaryMotion,
    reviewAt: detail.project.reviewAt,
    definition: detail.definition,
  };
}

export function baselineLabel(
  baseline: ProjectBriefDetail["definition"]["measurement"]["baseline"],
): string {
  if (baseline.kind === "unknown") return `未計測 — ${baseline.discoveryTask}`;
  if (baseline.kind === "assumption") {
    return `仮定 ${baseline.value} — ${baseline.evidenceThatWouldChange}`;
  }
  return `計測済み ${baseline.value} — ${baseline.source}`;
}

export function motionLabel(motion: ProjectBriefDetail["project"]["primaryMotion"]): string {
  return (
    {
      acquisition: "獲得",
      onboarding: "オンボーディング",
      engagement: "エンゲージメント",
      retention: "継続",
      reactivation: "再活性化",
      measurement: "計測",
    } as const
  )[motion];
}
