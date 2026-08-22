import { Check, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

import {
  ErrorAlert,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  FormTextarea,
  LoadingButton,
} from "@/components/app-ui";
import { ConfirmDialog } from "@/components/app-ui/dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { contactOptionLabel } from "@/features/contacts/contact-bits";
import {
  type DealCreate,
  type DealOptions,
  type DealStatus,
  type DealSummary,
  type DealTask,
  type DealTaskCreate,
  type DealTaskType,
} from "@/features/deals/deal-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { cn } from "@/lib/utils";
import { useWorkspaceFormatters, useWorkspaceTime } from "@/lib/workspace-time";

import { taskTypeLabel } from "./deal-labels";

export function DealForm({
  options,
  deal,
  initialPipelineId,
  submitLabel,
  onSubmit,
}: {
  options: DealOptions;
  deal?: DealSummary;
  initialPipelineId?: string;
  submitLabel: string;
  onSubmit: (values: DealCreate) => Promise<void>;
}): ReactNode {
  const firstPipelineId =
    deal?.pipelineId ??
    initialPipelineId ??
    options.pipelines.find((pipeline) => pipeline.isDefault)?.id ??
    options.pipelines[0]?.id ??
    "";
  const [pipelineId, setPipelineId] = useState(firstPipelineId);
  const [stageId, setStageId] = useState(deal?.stageId ?? "");
  const { busy, error, run } = useFormSubmission("商談を保存できませんでした");
  const stages = useMemo(
    () => options.pipelines.find((pipeline) => pipeline.id === pipelineId)?.stages ?? [],
    [options.pipelines, pipelineId],
  );
  const selectedStageId = stages.some((stage) => stage.id === stageId)
    ? stageId
    : (stages[0]?.id ?? "");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(() =>
      onSubmit({
        name: getFormString(form, "name").trim(),
        pipelineId,
        stageId: selectedStageId,
        value: Number(getFormString(form, "value") || "0"),
        currency: getFormString(form, "currency"),
        status: getFormString(form, "status") as DealStatus,
        ownerUserId: getFormString(form, "ownerUserId") || null,
        contactId: getFormString(form, "contactId") || null,
        companyId: getFormString(form, "companyId") || null,
        expectedCloseDate: getFormString(form, "expectedCloseDate") || null,
        description: getFormString(form, "description").trim(),
      }),
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        <FormInput
          label="商談名"
          name="name"
          defaultValue={deal?.name ?? ""}
          placeholder="例：Acme社 MA導入"
          required
        />
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <FormNativeSelect
            label="パイプライン"
            name="pipelineId"
            value={pipelineId}
            onChange={(event) => {
              setPipelineId(event.target.value);
              setStageId("");
            }}
            required
          >
            {options.pipelines.map((pipeline) => (
              <FormSelectOption key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
          <FormNativeSelect
            label="ステージ"
            name="stageId"
            value={selectedStageId}
            onChange={(event) => setStageId(event.target.value)}
            required
          >
            {stages.map((stage) => (
              <FormSelectOption key={stage.id} value={stage.id}>
                {stage.name}（{stage.probability}%）
              </FormSelectOption>
            ))}
          </FormNativeSelect>
        </FieldGroup>
        <FieldGroup className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <FormInput
            label="商談金額"
            name="value"
            type="number"
            min="0"
            step="1"
            defaultValue={deal?.value ?? 0}
            required
          />
          <FormNativeSelect label="通貨" name="currency" defaultValue={deal?.currency ?? "JPY"}>
            <FormSelectOption value="JPY">JPY</FormSelectOption>
            <FormSelectOption value="USD">USD</FormSelectOption>
            <FormSelectOption value="EUR">EUR</FormSelectOption>
          </FormNativeSelect>
        </FieldGroup>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <FormNativeSelect label="ステータス" name="status" defaultValue={deal?.status ?? "open"}>
            <FormSelectOption value="open">進行中</FormSelectOption>
            <FormSelectOption value="won">獲得</FormSelectOption>
            <FormSelectOption value="lost">失注</FormSelectOption>
          </FormNativeSelect>
          <FormInput
            label="完了予定日"
            name="expectedCloseDate"
            type="date"
            defaultValue={deal?.expectedCloseDate ?? ""}
          />
        </FieldGroup>
        <FormNativeSelect label="担当者" name="ownerUserId" defaultValue={deal?.ownerUserId ?? ""}>
          <FormSelectOption value="">未設定</FormSelectOption>
          {options.members.map((member) => (
            <FormSelectOption key={member.id} value={member.id}>
              {member.name || member.email}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <FormNativeSelect label="連絡先" name="contactId" defaultValue={deal?.contactId ?? ""}>
            <FormSelectOption value="">未設定</FormSelectOption>
            {options.contacts.map((contact) => (
              <FormSelectOption key={contact.id} value={contact.id}>
                {contactOptionLabel(contact)}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
          <FormNativeSelect label="会社" name="companyId" defaultValue={deal?.companyId ?? ""}>
            <FormSelectOption value="">未設定</FormSelectOption>
            {options.companies.map((company) => (
              <FormSelectOption key={company.id} value={company.id}>
                {company.name}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
        </FieldGroup>
        <FormTextarea
          label="説明・メモ"
          name="description"
          defaultValue={deal?.description ?? ""}
          rows={4}
          placeholder="商談の背景や次に確認する内容"
        />
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} busyLabel="保存中…" type="submit">
          {submitLabel}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

export function DealTaskForm({
  members,
  task,
  submitLabel,
  onSubmit,
}: {
  members: DealOptions["members"];
  task?: DealTask;
  submitLabel: string;
  onSubmit: (values: DealTaskCreate) => Promise<void>;
}): ReactNode {
  const { toDateTimeLocal } = useWorkspaceFormatters();
  const { busy, error, run } = useFormSubmission("タスクを保存できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const dueAt = getFormString(form, "dueAt");
    await run(() =>
      onSubmit({
        title: getFormString(form, "title").trim(),
        type: getFormString(form, "type") as DealTaskType,
        notes: getFormString(form, "notes").trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        assignedUserId: getFormString(form, "assignedUserId") || null,
      }),
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        <FormInput
          label="タスク名"
          name="title"
          defaultValue={task?.title ?? ""}
          placeholder="例：導入条件を電話で確認"
          required
        />
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <FormNativeSelect label="種別" name="type" defaultValue={task?.type ?? "task"}>
            <FormSelectOption value="task">タスク</FormSelectOption>
            <FormSelectOption value="call">電話</FormSelectOption>
            <FormSelectOption value="email">メール</FormSelectOption>
            <FormSelectOption value="meeting">ミーティング</FormSelectOption>
          </FormNativeSelect>
          <FormInput
            label="期限"
            name="dueAt"
            type="datetime-local"
            defaultValue={toDateTimeLocal(task?.dueAt)}
          />
        </FieldGroup>
        <FormNativeSelect
          label="担当者"
          name="assignedUserId"
          defaultValue={task?.assignedUserId ?? ""}
        >
          <FormSelectOption value="">未設定</FormSelectOption>
          {members.map((member) => (
            <FormSelectOption key={member.id} value={member.id}>
              {member.name || member.email}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormTextarea label="メモ" name="notes" defaultValue={task?.notes ?? ""} rows={3} />
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} busyLabel="保存中…" type="submit">
          {submitLabel}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

export function TaskRow({
  task,
  onEdit,
  onToggle,
  onDelete,
}: {
  task: DealTask;
  onEdit: () => void;
  onToggle: () => Promise<void>;
  onDelete: () => void;
}): ReactNode {
  const { formatMonthDayTime } = useWorkspaceFormatters();
  const { renderedAt } = useWorkspaceTime();
  const overdue =
    task.status === "open" &&
    task.dueAt &&
    new Date(task.dueAt).getTime() < new Date(renderedAt).getTime();
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-lg border p-3",
        task.status === "completed" && "bg-muted/40 opacity-70",
      )}
    >
      <Button
        variant={task.status === "completed" ? "secondary" : "outline"}
        size="icon-sm"
        aria-label={task.status === "completed" ? "未完了に戻す" : "完了にする"}
        onClick={() => void onToggle()}
      >
        <Check />
      </Button>
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium", task.status === "completed" && "line-through")}>
            {task.title}
          </span>
          <Badge variant="outline">{taskTypeLabel(task.type)}</Badge>
          {overdue ? <Badge variant="destructive">期限超過</Badge> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{task.dueAt ? formatMonthDayTime(task.dueAt) : "期限なし"}</span>
          <span>{task.assigneeName ?? "担当者未設定"}</span>
        </div>
        {task.notes ? (
          <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{task.notes}</p>
        ) : null}
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="タスクを編集" onClick={onEdit}>
          <Pencil />
        </Button>
        <ConfirmDialog
          title="タスクを削除しますか？"
          description={`「${task.title}」を削除します。`}
          confirmLabel="削除"
          triggerLabel="タスクを削除"
          trigger={<Button variant="ghost" size="icon-sm" />}
          triggerContent={<Trash2 />}
          onConfirm={onDelete}
        />
      </div>
    </div>
  );
}
