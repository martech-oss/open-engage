import { Sparkles } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert, LoadingButton } from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage } from "@/hooks/use-form-submission";
import type {
  ProjectBriefDetail,
  ProjectBriefDraftInput,
  ProjectMemberOption,
  ProjectResourceType,
} from "@openengage/core/projects";
import { PROJECT_RESOURCE_TYPES } from "@openengage/core/projects";

import { useGenerateProjectBrief } from "./project-brief-api";
import { mutationFromDetail } from "./project-brief-detail-components";
import {
  formDraftFromInput,
  mergeAiProposalPreservingEdits,
  ProjectBriefForm,
  type ProjectBriefFieldErrors,
  useProjectBriefDraft,
  validateProjectBriefDraft,
} from "./project-brief-form";

export function EditProjectBriefDialog({
  detail,
  members,
  onOpenChange,
  onSave,
}: {
  detail: ProjectBriefDetail;
  members: ProjectMemberOption[];
  onOpenChange: (open: boolean) => void;
  onSave: (input: ProjectBriefDraftInput) => Promise<void>;
}): ReactNode {
  const generate = useGenerateProjectBrief();
  const { draft, setDraft } = useProjectBriefDraft(mutationFromDetail(detail));
  const [prompt, setPrompt] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ProjectBriefFieldErrors>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function improve(): Promise<void> {
    if (!prompt.trim()) return;
    const validation = validateProjectBriefDraft(draft);
    if (!validation.success) {
      setFieldErrors(validation.errors);
      setError("AI改善前に入力内容を確認してください");
      return;
    }
    const before = draft;
    setError("");
    try {
      const result = await generate.mutateAsync({
        mode: "refine",
        prompt,
        current: validation.data,
      });
      const proposed = formDraftFromInput({
        ...result.proposal,
        ownerUserId: before.ownerUserId,
        approverUserId: before.approverUserId,
      });
      setDraft((current) => mergeAiProposalPreservingEdits(current, before, proposed));
      if (result.capabilityGaps.length) {
        toast.warning(`${result.capabilityGaps.length}件の未提供機能があります`);
      }
      toast.success("改善案をフォームへ反映しました。保存まではDBへ反映されません");
    } catch (cause) {
      setError(getErrorMessage(cause, "AI改善案を生成できませんでした"));
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const validation = validateProjectBriefDraft(draft);
    if (!validation.success) {
      setFieldErrors(validation.errors);
      setError("入力内容を確認してください");
      return;
    }
    setFieldErrors({});
    setError("");
    setSaving(true);
    try {
      await onSave(validation.data);
      onOpenChange(false);
    } catch (cause) {
      setError(getErrorMessage(cause, "施策ブリーフを保存できませんでした"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title="施策ブリーフを編集"
      className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"
    >
      <form className="space-y-4" onSubmit={(event) => void save(event)}>
        <Field>
          <FieldLabel htmlFor="brief-improve-prompt">AIで改善</FieldLabel>
          <Textarea
            id="brief-improve-prompt"
            rows={3}
            value={prompt}
            maxLength={4_000}
            disabled={generate.isPending || saving}
            placeholder="例: 失敗時のフォールバックと測定方法を具体化して"
            onChange={(event) => setPrompt(event.target.value)}
          />
          <LoadingButton
            type="button"
            busy={generate.isPending}
            disabled={!prompt.trim() || saving}
            variant="outline"
            onClick={() => void improve()}
          >
            <Sparkles data-icon="inline-start" />
            改善案をプレビュー
          </LoadingButton>
        </Field>
        <ProjectBriefForm
          value={draft}
          members={members}
          disabled={saving || generate.isPending}
          errors={fieldErrors}
          onChange={setDraft}
        />
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton className="w-full" type="submit" busy={saving}>
          保存
        </LoadingButton>
      </form>
    </AppDialog>
  );
}

export function ReviewProjectBriefDialog({
  kind,
  onOpenChange,
  onSubmit,
}: {
  kind: "approve" | "reject" | "withdraw";
  onOpenChange: (open: boolean) => void;
  onSubmit: (comment: string) => Promise<void>;
}): ReactNode {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const required = kind !== "approve";
  const title =
    kind === "approve" ? "施策を承認" : kind === "reject" ? "施策を差戻し" : "承認申請を取り消す";
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (required && !comment.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(comment.trim());
      onOpenChange(false);
    } catch (cause) {
      setError(getErrorMessage(cause, "操作を完了できませんでした"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppDialog open onOpenChange={onOpenChange} title={title}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <Field data-invalid={required && !comment.trim()}>
          <FieldLabel htmlFor="brief-review-comment">
            {kind === "approve"
              ? "承認コメント（任意）"
              : kind === "reject"
                ? "差戻し理由"
                : "取消理由"}
          </FieldLabel>
          <Textarea
            id="brief-review-comment"
            value={comment}
            maxLength={2_000}
            disabled={busy}
            required={required}
            onChange={(event) => setComment(event.target.value)}
          />
        </Field>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton type="submit" busy={busy} disabled={required && !comment.trim()}>
          {kind === "approve" ? "承認" : kind === "reject" ? "差戻し" : "申請を取り消す"}
        </LoadingButton>
      </form>
    </AppDialog>
  );
}

export function LinkProjectResourceDialog({
  onOpenChange,
  onSubmit,
}: {
  onOpenChange: (open: boolean) => void;
  onSubmit: (resourceType: ProjectResourceType, resourceId: string) => Promise<void>;
}): ReactNode {
  const [resourceType, setResourceType] = useState<ProjectResourceType>("segment");
  const [resourceId, setResourceId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!resourceId.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(resourceType, resourceId.trim());
      onOpenChange(false);
    } catch (cause) {
      setError(getErrorMessage(cause, "リソースをリンクできませんでした"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppDialog open onOpenChange={onOpenChange} title="既存リソースをリンク">
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <Field>
          <FieldLabel htmlFor="linked-resource-type">リソース種別</FieldLabel>
          <NativeSelect
            id="linked-resource-type"
            value={resourceType}
            disabled={busy}
            onChange={(event) => setResourceType(event.target.value as ProjectResourceType)}
          >
            {PROJECT_RESOURCE_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {PROJECT_RESOURCE_LABELS[type]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="linked-resource-id">リソースID</FieldLabel>
          <Input
            id="linked-resource-id"
            value={resourceId}
            disabled={busy}
            maxLength={191}
            onChange={(event) => setResourceId(event.target.value)}
          />
        </Field>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton type="submit" busy={busy} disabled={!resourceId.trim()}>
          リンク
        </LoadingButton>
      </form>
    </AppDialog>
  );
}

const PROJECT_RESOURCE_LABELS = {
  automation: "Automation",
  email_sequence: "Email sequence",
  segment: "Segment",
  form: "Form",
  landing_page: "Landing page",
  redirect: "Redirect",
} satisfies Record<ProjectResourceType, string>;
