import { useSuspenseQuery } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert, PageLayout } from "@/components/app-ui";
import { useCreateAutomation } from "@/features/automations/automation-api";
import { useCreateSegment } from "@/features/segments/segment-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type {
  ProjectBriefDraftInput,
  ProjectLinkedResource,
  ProjectResourceType,
} from "@openengage/core/projects";

import {
  projectBriefOptionsQueryOptions,
  projectBriefQueryOptions,
  useAddProjectBriefItem,
  useApproveProjectBrief,
  useArchiveProjectBrief,
  useCompleteProjectBrief,
  useRejectProjectBrief,
  useRemoveProjectBriefItem,
  useReopenProjectBrief,
  useSubmitProjectBrief,
  useUpdateProjectBrief,
  useWithdrawProjectBrief,
} from "./project-brief-api";
import { motionLabel } from "./project-brief-detail-components";
import {
  EditProjectBriefDialog,
  LinkProjectResourceDialog,
  ReviewProjectBriefDialog,
} from "./project-brief-detail-dialogs";
import { ProjectBriefDetailHeader } from "./project-brief-detail-header";
import {
  LinkedResources,
  ProjectBriefHistory,
  ProjectBriefOverview,
} from "./project-brief-detail-view";

type ReviewAction = "approve" | "reject" | "withdraw";
type GenerationAction = "segment" | "sequence" | "automation";

const AutomationAiSheet = lazy(async () => ({
  default: (await import("@/features/automations/automation-ai-sheet")).AutomationAiSheet,
}));
const EmailSequenceAiSheet = lazy(async () => ({
  default: (await import("@/features/automations/email-sequence-ai-sheet")).EmailSequenceAiSheet,
}));
const SegmentAiSheet = lazy(async () => ({
  default: (await import("@/features/segments/segment-ai-sheet")).SegmentAiSheet,
}));

export function ProjectBriefDetailPage({ id }: { id: string }): ReactNode {
  const { data: detail } = useSuspenseQuery(projectBriefQueryOptions(id));
  const { data: options } = useSuspenseQuery(projectBriefOptionsQueryOptions());
  const update = useUpdateProjectBrief();
  const submit = useSubmitProjectBrief();
  const approve = useApproveProjectBrief();
  const reject = useRejectProjectBrief();
  const withdraw = useWithdrawProjectBrief();
  const reopen = useReopenProjectBrief();
  const complete = useCompleteProjectBrief();
  const archive = useArchiveProjectBrief();
  const addItem = useAddProjectBriefItem();
  const removeItem = useRemoveProjectBriefItem();
  const createSegment = useCreateSegment();
  const createAutomation = useCreateAutomation();
  const [editOpen, setEditOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState<GenerationAction | null>(null);
  const [error, setError] = useState("");
  const headerBusy = [submit, reopen, complete, archive].some((mutation) => mutation.isPending);

  async function run(operation: () => Promise<unknown>, success: string): Promise<void> {
    setError("");
    try {
      await operation();
      toast.success(success);
    } catch (cause) {
      setError(getErrorMessage(cause, "操作を完了できませんでした"));
    }
  }

  async function review(comment: string): Promise<void> {
    if (reviewAction === "approve") {
      await approve.mutateAsync({ id, comment, expectedRowVersion: detail.rowVersion });
      toast.success("承認しました");
    } else if (reviewAction === "reject") {
      await reject.mutateAsync({ id, comment, expectedRowVersion: detail.rowVersion });
      toast.success("差戻しました");
    } else {
      await withdraw.mutateAsync({ id, reason: comment, expectedRowVersion: detail.rowVersion });
      toast.success("承認申請を取り消しました");
    }
  }

  async function saveBrief(input: ProjectBriefDraftInput): Promise<void> {
    await update.mutateAsync({ id, ...input, expectedRowVersion: detail.rowVersion });
    toast.success("保存しました");
  }

  async function linkResource(
    resourceType: ProjectResourceType,
    resourceId: string,
  ): Promise<void> {
    await addItem.mutateAsync({
      id,
      resourceType,
      resourceId,
      expectedRowVersion: detail.rowVersion,
    });
    toast.success("リンクしました");
  }

  function removeResource(item: ProjectLinkedResource): void {
    void run(
      () =>
        removeItem.mutateAsync({
          id,
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          expectedRowVersion: detail.rowVersion,
        }),
      "リンクを削除しました",
    );
  }

  return (
    <PageLayout
      title={`${detail.project.name} · ${motionLabel(detail.project.primaryMotion)} · rev.${detail.project.revision}`}
      action={
        <ProjectBriefDetailHeader
          detail={detail}
          busy={headerBusy}
          onEdit={() => setEditOpen(true)}
          onSubmit={() =>
            void run(
              () => submit.mutateAsync({ id, expectedRowVersion: detail.rowVersion }),
              "承認を依頼しました",
            )
          }
          onReview={setReviewAction}
          onWithdraw={() => setReviewAction("withdraw")}
          onReopen={() =>
            void run(
              () => reopen.mutateAsync({ id, expectedRowVersion: detail.rowVersion }),
              "再編集できる状態に戻しました",
            )
          }
          onComplete={() =>
            void run(
              () => complete.mutateAsync({ id, expectedRowVersion: detail.rowVersion }),
              "施策を終了しました",
            )
          }
          onArchive={() =>
            void run(
              () => archive.mutateAsync({ id, expectedRowVersion: detail.rowVersion }),
              "アーカイブしました",
            )
          }
        />
      }
    >
      {error ? <ErrorAlert>{error}</ErrorAlert> : null}
      <ProjectBriefOverview detail={detail} />
      <LinkedResources
        detail={detail}
        removing={removeItem.isPending}
        onLink={() => setLinkOpen(true)}
        onGenerate={setGenerationOpen}
        onRemove={removeResource}
      />
      <ProjectBriefHistory detail={detail} />

      {editOpen ? (
        <EditProjectBriefDialog
          key={detail.rowVersion}
          detail={detail}
          members={options.members}
          onOpenChange={setEditOpen}
          onSave={saveBrief}
        />
      ) : null}
      {reviewAction ? (
        <ReviewProjectBriefDialog
          key={reviewAction}
          kind={reviewAction}
          onOpenChange={(open) => {
            if (!open) setReviewAction(null);
          }}
          onSubmit={review}
        />
      ) : null}
      {linkOpen ? (
        <LinkProjectResourceDialog onOpenChange={setLinkOpen} onSubmit={linkResource} />
      ) : null}

      <Suspense fallback={null}>
        {generationOpen === "segment" ? (
          <SegmentAiSheet
            open
            onOpenChange={(open) => setGenerationOpen(open ? "segment" : null)}
            mode="create"
            entityId={`${id}:segment`}
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
              toast.success("セグメントの下書きを作成し、施策へリンクしました");
            }}
          />
        ) : null}
        {generationOpen === "automation" ? (
          <AutomationAiSheet
            open
            onOpenChange={(open) => setGenerationOpen(open ? "automation" : null)}
            mode="create"
            entityId={`${id}:automation`}
            projectId={id}
            briefRevision={detail.project.revision}
            onApply={async (definition) => {
              await createAutomation.mutateAsync({
                ...definition,
                projectId: id,
                briefRevision: detail.project.revision,
              });
              setGenerationOpen(null);
              toast.success("フローの下書きを作成し、施策へリンクしました");
            }}
          />
        ) : null}
        {generationOpen === "sequence" ? (
          <EmailSequenceAiSheet
            open
            entityId={`${id}:sequence`}
            onOpenChange={(open) => setGenerationOpen(open ? "sequence" : null)}
            projectId={id}
            briefRevision={detail.project.revision}
            onApplied={async () => {
              toast.success("メールとフローの下書きを作成し、施策へリンクしました");
            }}
          />
        ) : null}
      </Suspense>
    </PageLayout>
  );
}
