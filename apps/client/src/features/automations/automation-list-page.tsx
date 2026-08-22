import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch, Mail, Pause, Play, Plus, Sparkles } from "lucide-react";
import { lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  PageLayout,
  SimpleEmpty,
} from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { emailTemplateOptionsQueryOptions } from "@/features/emails/email-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { AutomationRow } from "@openengage/core/automations";

import {
  automationsQueryOptions,
  useCreateAutomation,
  useSetAutomationStatus,
} from "./automation-api";
import { triggerLabel } from "./automation-labels";
import { createPresetAutomation, type PresetId, presets } from "./automation-presets";
import { AutomationStatusBadge } from "./automation-status-badge";

const AutomationAiSheet = lazy(async () => ({
  default: (await import("./automation-ai-sheet")).AutomationAiSheet,
}));
const EmailSequenceAiSheet = lazy(async () => ({
  default: (await import("./email-sequence-ai-sheet")).EmailSequenceAiSheet,
}));

export function AutomationsPage(): ReactNode {
  const { formatDateTime } = useWorkspaceFormatters();
  const navigate = useNavigate();
  const { data: automations } = useSuspenseQuery(automationsQueryOptions());
  const { data: allTemplates } = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const templates = useMemo(
    () => allTemplates.filter((template) => template.sendable),
    [allTemplates],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [sequenceOpen, setSequenceOpen] = useState(false);
  const [preset, setPreset] = useState<PresetId>("welcome");
  const [name, setName] = useState("ウェルカムシリーズ");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const createAutomation = useCreateAutomation();
  const setAutomationStatus = useSetAutomationStatus();

  function selectPreset(value: PresetId): void {
    setPreset(value);
    setName(presets.find((item) => item.id === value)?.name ?? "");
  }

  async function createAutomationFlow(): Promise<void> {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      toast.error("使用するメールテンプレートを選択してください");
      return;
    }
    setCreating(true);
    try {
      const created = await createAutomation.mutateAsync(
        createPresetAutomation(name.trim(), preset, template),
      );
      setCreateOpen(false);
      await navigate({ to: "/automations/$id", params: { id: created.id } });
    } catch (error) {
      toast.error(getErrorMessage(error, "オートメーションを作成できません"));
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(automation: AutomationRow): Promise<void> {
    const status = automation.status === "active" ? "paused" : "active";
    try {
      await setAutomationStatus.mutateAsync({ id: automation.id, status });
      toast.success(status === "active" ? "オートメーションを再開しました" : "一時停止しました");
    } catch (error) {
      toast.error(getErrorMessage(error, "更新できませんでした"));
    }
  }

  return (
    <PageLayout
      title="オートメーション"
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSequenceOpen(true)}>
            <Mail data-icon="inline-start" />
            AIメールシーケンス
          </Button>
          <Button variant="outline" onClick={() => setAiOpen(true)}>
            <Sparkles data-icon="inline-start" />
            AIで作成
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            フローを作成
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {automations.map((automation) => (
          <Card key={automation.id} className="transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <GitBranch className="size-4" />
              </div>
              <CardTitle>{automation.name}</CardTitle>
              <CardDescription>{triggerLabel(automation.triggerSource)}</CardDescription>
              <CardAction>
                <AutomationStatusBadge status={automation.status} />
              </CardAction>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <Metric label="登録" value={automation.enrollmentCount} />
              <Metric label="進行中" value={automation.activeCount} />
              <Metric label="完了" value={automation.completedCount} />
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {formatDateTime(automation.updatedAt)}
              </span>
              <div className="flex gap-1">
                {automation.status === "active" || automation.status === "paused" ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={automation.status === "active" ? "一時停止" : "再開"}
                    onClick={() => void changeStatus(automation)}
                  >
                    {automation.status === "active" ? <Pause /> : <Play />}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigate({ to: "/automations/$id", params: { id: automation.id } })
                  }
                >
                  編集
                </Button>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>
      {automations.length === 0 ? (
        <SimpleEmpty label="テンプレートから最初のオートメーションを作成しましょう" />
      ) : null}
      <AppDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="オートメーションを作成"
        description="目的に近いテンプレートを選び、あとからフローを調整できます。"
        className="sm:max-w-3xl"
      >
        <ToggleGroup
          value={[preset]}
          onValueChange={(values) => {
            const nextPreset = values[0] as PresetId | undefined;
            if (nextPreset) selectPreset(nextPreset);
          }}
          variant="outline"
          className="grid w-full gap-3 sm:grid-cols-2"
        >
          {presets.map((item) => (
            <ToggleGroupItem
              key={item.id}
              value={item.id}
              aria-label={item.name}
              className="h-auto items-start justify-start gap-3 p-4 text-left whitespace-normal"
            >
              <item.icon data-icon="inline-start" />
              <span className="flex flex-col items-start gap-1">
                <span className="font-medium">{item.name}</span>
                <span className="text-sm leading-5 text-muted-foreground">{item.description}</span>
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldGroup className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <FormInput
            name="automationName"
            label="フロー名"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <FormNativeSelect
            name="templateId"
            label="送信するメール"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <FormSelectOption value="">選択してください</FormSelectOption>
            {templates.map((template) => (
              <FormSelectOption key={template.id} value={template.id}>
                {template.name}
                {template.subject ? ` · ${template.subject}` : ""}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
        </FieldGroup>
        {templates.length === 0 ? (
          <p className="text-sm text-destructive">
            先に「メール → テンプレート」で送信内容を作成してください。
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCreateOpen(false)}>
            キャンセル
          </Button>
          <Button
            disabled={creating || !name.trim() || !templateId}
            onClick={() => void createAutomationFlow()}
          >
            {creating ? "作成中..." : "このテンプレートで作成"}
          </Button>
        </div>
      </AppDialog>
      <Suspense fallback={null}>
        {aiOpen ? (
          <AutomationAiSheet
            open
            onOpenChange={setAiOpen}
            mode="create"
            entityId="new-automation"
            onApply={async (definition) => {
              const created = await createAutomation.mutateAsync(definition);
              setAiOpen(false);
              await navigate({ to: "/automations/$id", params: { id: created.id } });
            }}
          />
        ) : null}
        {sequenceOpen ? (
          <EmailSequenceAiSheet
            open
            entityId="new-sequence"
            onOpenChange={setSequenceOpen}
            onApplied={async (created) => {
              setSequenceOpen(false);
              await navigate({ to: "/automations/$id", params: { id: created.automationId } });
            }}
          />
        ) : null}
      </Suspense>
    </PageLayout>
  );
}

function Metric({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
