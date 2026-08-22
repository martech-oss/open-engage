import { CircleAlert, Link2, X } from "lucide-react";
import type { ReactNode } from "react";

import { SimpleEmpty } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useWorkspaceFormatters, useWorkspaceTime } from "@/lib/workspace-time";
import type { ProjectBriefDetail, ProjectLinkedResource } from "@openengage/core/projects";

import { baselineLabel, BriefSection } from "./project-brief-detail-components";
import { isReviewOverdue } from "./project-brief-list-filters";

const CAPABILITY_LABELS = {
  marketingEmailDelivery: "Marketing配信",
  emailOpenTracking: "開封計測",
  emailClickTracking: "クリック計測",
  ga4Integration: "GA4連携",
} as const;

export function ProjectBriefOverview({ detail }: { detail: ProjectBriefDetail }): ReactNode {
  const { formatDateTime } = useWorkspaceFormatters();
  const { renderedAt } = useWorkspaceTime();
  const definition = detail.definition;
  return (
    <>
      {isReviewOverdue(detail.project, new Date(renderedAt).getTime()) ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>レビュー期限を超過しています</AlertTitle>
          <AlertDescription>
            成果指標を確認し、施策を終了するか再編集してください。
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <BriefSection
          title="Decision"
          rows={[
            ["Outcome", definition.outcome],
            ["対象者", definition.audience],
            ["ライフサイクル", definition.lifecycleMoment],
            ["確信度", definition.confidence],
          ]}
        />
        <BriefSection
          title="Flow"
          rows={[
            ["Entry trigger", definition.entryTrigger],
            ["対象条件", definition.eligibility.join("\n") || "なし"],
            ["除外条件", definition.exclusions.join("\n") || "なし"],
            ["Actions", definition.actions.join("\n")],
            ["終了条件", definition.exitCondition],
            ["失敗時", definition.failureBehavior],
          ]}
        />
        <BriefSection
          title="Delivery"
          rows={[
            ["担当者", detail.project.ownerName],
            ["承認者", detail.project.approverName],
            ["同意", definition.consentRequirement],
            ["抑止", definition.suppressionRules],
            ["頻度", definition.frequencyPolicy],
            ["実施時期", definition.deliveryHorizon],
          ]}
        />
        <BriefSection
          title="Measurement"
          rows={[
            [
              "成果指標",
              `${definition.measurement.outcomeMetric.name} — ${definition.measurement.outcomeMetric.proof}`,
            ],
            [
              "早期シグナル",
              `${definition.measurement.earlySignal.name} — ${definition.measurement.earlySignal.proof}`,
            ],
            ["ベースライン", baselineLabel(definition.measurement.baseline)],
            ["成功基準", definition.measurement.successThreshold],
            ["レビュー", formatDateTime(detail.project.reviewAt)],
          ]}
        />
        <BriefSection
          title="Immediate next steps"
          rows={definition.immediateNextSteps.map((item, index) => [`${index + 1}`, item])}
        />
        <BriefSection
          title="Not included yet"
          rows={(definition.notIncluded.length ? definition.notIncluded : ["なし"]).map(
            (item, index) => [`${index + 1}`, item],
          )}
        />
      </div>
      <CapabilityBoundary detail={detail} />
    </>
  );
}

function CapabilityBoundary({ detail }: { detail: ProjectBriefDetail }): ReactNode {
  const unavailable = Object.entries(detail.capabilities).filter(
    ([, capability]) => capability.state !== "configured",
  );
  if (!unavailable.length) return null;
  return (
    <Alert>
      <CircleAlert />
      <AlertTitle>現在の製品境界</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-5">
          {unavailable.map(([key, capability]) => (
            <li key={key}>
              {CAPABILITY_LABELS[key as keyof typeof CAPABILITY_LABELS]}: {capability.reason}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export function LinkedResources({
  detail,
  removing,
  onLink,
  onGenerate,
  onRemove,
}: {
  detail: ProjectBriefDetail;
  removing: boolean;
  onLink: () => void;
  onGenerate: (type: "segment" | "sequence" | "automation") => void;
  onRemove: (item: ProjectLinkedResource) => void;
}): ReactNode {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">関連リソース</h2>
        {detail.allowedActions.addResource ? (
          <Button size="sm" variant="outline" onClick={onLink}>
            <Link2 data-icon="inline-start" />
            既存リソースをリンク
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {(["segment", "sequence", "automation"] as const).map((type) => (
          <Button
            key={type}
            variant="outline"
            disabled={!detail.allowedActions.addResource}
            onClick={() => onGenerate(type)}
          >
            {type === "segment"
              ? "Segment"
              : type === "sequence"
                ? "Email Sequence"
                : "Automation Flow"}
            を生成
          </Button>
        ))}
      </div>
      {detail.items.length ? (
        <div className="grid gap-2">
          {detail.items.map((item) => (
            <Card key={`${item.resourceType}:${item.resourceId}`}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.resourceType} · {item.status ?? "状態なし"} · rev.
                    {item.briefRevision ?? "-"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {item.availability !== "available" ? (
                    <Badge variant="outline">
                      {item.availability === "archived" ? "アーカイブ済み" : "削除済み"}
                    </Badge>
                  ) : null}
                  {item.stale ? <Badge variant="destructive">再確認</Badge> : null}
                  {detail.allowedActions.removeResource ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={removing}
                      aria-label={`${item.name}のリンクを削除`}
                      onClick={() => onRemove(item)}
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <SimpleEmpty label="関連リソースはありません" />
      )}
    </section>
  );
}

export function ProjectBriefHistory({ detail }: { detail: ProjectBriefDetail }): ReactNode {
  const { formatDateTime } = useWorkspaceFormatters();
  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">承認履歴</h2>
        {detail.reviews.length ? (
          detail.reviews.map((review) => (
            <div key={review.id} className="rounded-lg border p-3 text-sm">
              <strong>{review.reviewerName}</strong> ·{" "}
              {review.decision === "approved" ? "承認" : "差戻し"} · rev.{review.revision}
              <p className="text-muted-foreground">
                {review.comment || "コメントなし"} · {formatDateTime(review.createdAt)}
              </p>
            </div>
          ))
        ) : (
          <SimpleEmpty label="承認履歴はありません" />
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">監査情報</h2>
        {detail.audit.length ? (
          detail.audit.map((event) => (
            <div key={event.id} className="rounded-lg border p-3 text-sm">
              <strong>{event.action}</strong> · {event.actorName}
              <p className="text-muted-foreground">{formatDateTime(event.createdAt)}</p>
            </div>
          ))
        ) : (
          <SimpleEmpty label="監査イベントはありません" />
        )}
      </section>
    </>
  );
}
