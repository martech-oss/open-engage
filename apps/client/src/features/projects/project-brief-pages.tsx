import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  Archive,
  Check,
  CircleAlert,
  Link2,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { AppDialog, ErrorAlert, LoadingButton, PageLayout, SimpleEmpty } from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { AutomationAiSheet } from "@/features/automations/automation-ai-sheet";
import { useCreateAutomation } from "@/features/automations/automation-api";
import { EmailSequenceAiSheet } from "@/features/automations/email-sequence-ai-sheet";
import { SegmentAiSheet } from "@/features/segments/segment-ai-sheet";
import { useCreateSegment } from "@/features/segments/segment-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { formatDateTime } from "@/lib/format";
import type { ProjectBriefMutation, ProjectResourceType } from "@openengage/core/projects";

import {
  projectBriefOptionsQueryOptions,
  projectBriefQueryOptions,
  projectBriefsQueryOptions,
  useAddProjectBriefItem,
  useApproveProjectBrief,
  useArchiveProjectBrief,
  useCompleteProjectBrief,
  useGenerateProjectBrief,
  useRejectProjectBrief,
  useRemoveProjectBriefItem,
  useReopenProjectBrief,
  useSubmitProjectBrief,
  useUpdateProjectBrief,
} from "./project-brief-api";
import {
  baselineLabel,
  BriefSection,
  BriefStatus,
  motionLabel,
  mutationFromDetail,
} from "./project-brief-detail-components";
import { ProjectBriefForm } from "./project-brief-form";

const appRoute = getRouteApi("/_app");

export function ProjectBriefDetailPage({ id }: { id: string }): ReactNode {
  const { data: detail } = useSuspenseQuery(projectBriefQueryOptions(id));
  const { data: options } = useSuspenseQuery(projectBriefOptionsQueryOptions());
  const { session, workspace } = appRoute.useRouteContext();
  const queryClient = useQueryClient();
  const update = useUpdateProjectBrief();
  const submit = useSubmitProjectBrief();
  const approve = useApproveProjectBrief();
  const reject = useRejectProjectBrief();
  const reopen = useReopenProjectBrief();
  const complete = useCompleteProjectBrief();
  const archive = useArchiveProjectBrief();
  const addItem = useAddProjectBriefItem();
  const removeItem = useRemoveProjectBriefItem();
  const generate = useGenerateProjectBrief();
  const createSegment = useCreateSegment();
  const createAutomation = useCreateAutomation();
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<ProjectBriefMutation>(() => mutationFromDetail(detail));
  const [reviewOpen, setReviewOpen] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [resourceType, setResourceType] = useState<ProjectResourceType>("segment");
  const [resourceId, setResourceId] = useState("");
  const [error, setError] = useState("");
  const [improvePrompt, setImprovePrompt] = useState("");
  const [generationOpen, setGenerationOpen] = useState<
    "segment" | "sequence" | "automation" | null
  >(null);
  const isOwner = detail.project.ownerUserId === session.user.id;
  const isApprover = detail.project.approverUserId === session.user.id;
  const isAdmin = workspace.role === "admin" || workspace.role === "owner";
  const canOperate = isOwner || isAdmin;

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: projectBriefQueryOptions(id).queryKey }),
      queryClient.invalidateQueries({ queryKey: projectBriefsQueryOptions().queryKey }),
    ]);
  }

  async function run(operation: () => Promise<unknown>, success: string): Promise<void> {
    setError("");
    try {
      await operation();
      await refresh();
      toast.success(success);
    } catch (cause) {
      setError(getErrorMessage(cause, "操作を完了できませんでした"));
    }
  }

  async function improveDraft(): Promise<void> {
    if (!improvePrompt.trim()) return;
    setError("");
    try {
      const result = await generate.mutateAsync({
        mode: "refine",
        prompt: improvePrompt,
        current: draft,
      });
      setDraft({
        ...draft,
        ...result.proposal,
        ownerUserId: draft.ownerUserId,
        approverUserId: draft.approverUserId,
      });
      if (result.capabilityGaps.length) {
        toast.warning(`${result.capabilityGaps.length}件の未提供機能があります`);
      }
      toast.success("AIの改善案を編集フォームへ反映しました。保存まではDBへ反映されません");
    } catch (cause) {
      setError(getErrorMessage(cause, "AI改善案を生成できませんでした"));
    }
  }

  const definition = detail.definition;
  return (
    <PageLayout
      title={`${detail.project.name} · ${motionLabel(detail.project.primaryMotion)} · rev.${detail.project.revision}`}
      action={
        <div className="flex flex-wrap gap-2">
          <BriefStatus status={detail.project.status} />
          {detail.project.status === "draft" ? (
            <>
              {isOwner ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft(mutationFromDetail(detail));
                    setImprovePrompt("");
                    setEditOpen(true);
                  }}
                >
                  <Pencil data-icon="inline-start" />
                  編集
                </Button>
              ) : null}
              {isOwner ? (
                <Button
                  onClick={() => void run(() => submit.mutateAsync({ id }), "承認を依頼しました")}
                >
                  <Send data-icon="inline-start" />
                  承認依頼
                </Button>
              ) : null}
            </>
          ) : null}
          {detail.project.status === "pending_approval" && isApprover ? (
            <>
              <Button onClick={() => setReviewOpen("approve")}>
                <Check data-icon="inline-start" />
                承認
              </Button>
              <Button variant="destructive" onClick={() => setReviewOpen("reject")}>
                <X data-icon="inline-start" />
                差戻し
              </Button>
            </>
          ) : null}
          {(detail.project.status === "approved" || detail.project.status === "completed") &&
          canOperate ? (
            <Button
              variant="outline"
              onClick={() =>
                void run(() => reopen.mutateAsync({ id }), "再編集できる状態に戻しました")
              }
            >
              <RotateCcw data-icon="inline-start" />
              再オープン
            </Button>
          ) : null}
          {detail.project.status === "approved" && canOperate ? (
            <Button
              variant="outline"
              onClick={() => void run(() => complete.mutateAsync({ id }), "施策を終了しました")}
            >
              終了
            </Button>
          ) : null}
          {isAdmin ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="アーカイブ"
              onClick={() => void run(() => archive.mutateAsync({ id }), "アーカイブしました")}
            >
              <Archive />
            </Button>
          ) : null}
        </div>
      }
    >
      {error ? <ErrorAlert>{error}</ErrorAlert> : null}
      {detail.project.status === "approved" &&
      new Date(detail.project.reviewAt).getTime() < Date.now() ? (
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
      <Alert>
        <CircleAlert />
        <AlertTitle>現在の製品境界</AlertTitle>
        <AlertDescription>
          Marketing配信、完全な開封・クリック計測、GA4連携は未提供です。関連する下書きは作成できますが、自動公開・配信されません。
        </AlertDescription>
      </Alert>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">関連リソース</h2>
          {detail.project.status === "approved" && canOperate ? (
            <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
              <Link2 data-icon="inline-start" />
              既存リソースをリンク
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={detail.project.status !== "approved" || !canOperate}
            onClick={() => setGenerationOpen("segment")}
          >
            Segmentを生成
          </Button>
          <Button
            variant="outline"
            disabled={detail.project.status !== "approved" || !canOperate}
            onClick={() => setGenerationOpen("sequence")}
          >
            Email Sequenceを生成
          </Button>
          <Button
            variant="outline"
            disabled={detail.project.status !== "approved" || !canOperate}
            onClick={() => setGenerationOpen("automation")}
          >
            Automation Flowを生成
          </Button>
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
                    {item.stale ? <Badge variant="destructive">再確認</Badge> : null}
                    {canOperate ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="リンクを削除"
                        onClick={() =>
                          void run(
                            () =>
                              removeItem.mutateAsync({
                                id,
                                resourceType: item.resourceType,
                                resourceId: item.resourceId,
                              }),
                            "リンクを削除しました",
                          )
                        }
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
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">承認履歴</h2>
        {detail.reviews.map((review) => (
          <div key={review.id} className="rounded-lg border p-3 text-sm">
            <strong>{review.reviewerName}</strong> ·{" "}
            {review.decision === "approved" ? "承認" : "差戻し"} · rev.{review.revision}
            <p className="text-muted-foreground">
              {review.comment || "コメントなし"} · {formatDateTime(review.createdAt)}
            </p>
          </div>
        ))}
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
      <AppDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="施策ブリーフを編集"
        className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"
      >
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="brief-improve-prompt">AIで改善</FieldLabel>
            <Textarea
              id="brief-improve-prompt"
              rows={3}
              value={improvePrompt}
              maxLength={4_000}
              placeholder="例: 失敗時のフォールバックと測定方法を具体化して"
              onChange={(event) => setImprovePrompt(event.target.value)}
            />
            <LoadingButton
              busy={generate.isPending}
              disabled={!improvePrompt.trim()}
              variant="outline"
              onClick={() => void improveDraft()}
            >
              <Sparkles data-icon="inline-start" />
              改善案をプレビュー
            </LoadingButton>
          </Field>
          <ProjectBriefForm value={draft} members={options.members} onChange={setDraft} />
          <LoadingButton
            className="w-full"
            busy={update.isPending}
            onClick={() =>
              void run(async () => {
                await update.mutateAsync({ id, ...draft });
                setEditOpen(false);
              }, "保存しました")
            }
          >
            保存
          </LoadingButton>
        </div>
      </AppDialog>
      <AppDialog
        open={Boolean(reviewOpen)}
        onOpenChange={(open) => {
          if (!open) setReviewOpen(null);
        }}
        title={reviewOpen === "approve" ? "施策を承認" : "施策を差戻し"}
      >
        <div className="space-y-4">
          <Textarea
            value={comment}
            placeholder={reviewOpen === "reject" ? "差戻し理由（必須）" : "承認コメント（任意）"}
            onChange={(event) => setComment(event.target.value)}
          />
          <LoadingButton
            busy={approve.isPending || reject.isPending}
            disabled={reviewOpen === "reject" && !comment.trim()}
            onClick={() =>
              void run(
                async () => {
                  if (reviewOpen === "approve") await approve.mutateAsync({ id, comment });
                  else await reject.mutateAsync({ id, comment });
                  setReviewOpen(null);
                  setComment("");
                },
                reviewOpen === "approve" ? "承認しました" : "差戻しました",
              )
            }
          >
            {reviewOpen === "approve" ? "承認" : "差戻し"}
          </LoadingButton>
        </div>
      </AppDialog>
      <AppDialog open={linkOpen} onOpenChange={setLinkOpen} title="既存リソースをリンク">
        <div className="space-y-4">
          <NativeSelect
            value={resourceType}
            onChange={(event) => setResourceType(event.target.value as ProjectResourceType)}
          >
            <NativeSelectOption value="segment">Segment</NativeSelectOption>
            <NativeSelectOption value="email">Email</NativeSelectOption>
            <NativeSelectOption value="automation">Automation</NativeSelectOption>
            <NativeSelectOption value="form">Form</NativeSelectOption>
            <NativeSelectOption value="page">Page</NativeSelectOption>
          </NativeSelect>
          <Input
            value={resourceId}
            placeholder="リソースID"
            onChange={(event) => setResourceId(event.target.value)}
          />
          <LoadingButton
            busy={addItem.isPending}
            disabled={!resourceId.trim()}
            onClick={() =>
              void run(async () => {
                await addItem.mutateAsync({ id, resourceType, resourceId });
                setLinkOpen(false);
                setResourceId("");
              }, "リンクしました")
            }
          >
            リンク
          </LoadingButton>
        </div>
      </AppDialog>
      <SegmentAiSheet
        open={generationOpen === "segment"}
        onOpenChange={(open) => setGenerationOpen(open ? "segment" : null)}
        mode="create"
        projectId={id}
        briefRevision={detail.project.revision}
        onApply={async (definition) => {
          await createSegment.mutateAsync({
            name: definition.name,
            slug: definition.slug,
            description: definition.description,
            kind: definition.kind,
            ...(definition.filter ? { filter: definition.filter } : {}),
            membershipSource: definition.membershipSource,
            projectId: id,
            briefRevision: detail.project.revision,
          });
          await refresh();
          toast.success("セグメントの下書きを作成し、施策へリンクしました");
        }}
      />
      <AutomationAiSheet
        open={generationOpen === "automation"}
        onOpenChange={(open) => setGenerationOpen(open ? "automation" : null)}
        mode="create"
        projectId={id}
        briefRevision={detail.project.revision}
        onApply={async (definition) => {
          await createAutomation.mutateAsync({
            ...definition,
            projectId: id,
            briefRevision: detail.project.revision,
          });
          setGenerationOpen(null);
          await refresh();
          toast.success("フローの下書きを作成し、施策へリンクしました");
        }}
      />
      <EmailSequenceAiSheet
        open={generationOpen === "sequence"}
        onOpenChange={(open) => setGenerationOpen(open ? "sequence" : null)}
        projectId={id}
        briefRevision={detail.project.revision}
        onApplied={async () => {
          await refresh();
          toast.success("メールとフローの下書きを作成し、施策へリンクしました");
        }}
      />
    </PageLayout>
  );
}
