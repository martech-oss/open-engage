import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ChevronDown, GitBranch, Mail, Plus, Sparkles } from "lucide-react";
import { lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { FormInput, FormNativeSelect, FormSelectOption, PageLayout } from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { emailTemplateOptionsQueryOptions } from "@/features/emails/email-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { useWorkspaceTime } from "@/lib/workspace-time";

import { automationsQueryOptions, useCreateAutomation } from "./automation-api";
import { AutomationMonitoringTable } from "./automation-monitoring-table";
import {
  createBlankAutomation,
  createPresetAutomation,
  type PresetId,
  presets,
} from "./automation-presets";

const AutomationAiSheet = lazy(async () => ({
  default: (await import("./automation-ai-sheet")).AutomationAiSheet,
}));
const EmailSequenceAiSheet = lazy(async () => ({
  default: (await import("./email-sequence-ai-sheet")).EmailSequenceAiSheet,
}));

const listRoute = getRouteApi("/_app/automations/");

export function AutomationsPage(): ReactNode {
  const { timeZone } = useWorkspaceTime();
  const navigate = useNavigate();
  const search = listRoute.useSearch();
  const { data: automations } = useSuspenseQuery(automationsQueryOptions());
  const { data: allTemplates } = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const templates = useMemo(
    () => allTemplates.filter((template) => template.sendable),
    [allTemplates],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [sequenceOpen, setSequenceOpen] = useState(false);
  const [preset, setPreset] = useState<PresetId | "blank">("blank");
  const [name, setName] = useState("新しいフロー");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const createAutomation = useCreateAutomation();

  function selectPreset(value: PresetId | "blank"): void {
    setPreset(value);
    setName(
      value === "blank" ? "新しいフロー" : (presets.find((item) => item.id === value)?.name ?? ""),
    );
  }

  async function createAutomationFlow(): Promise<void> {
    const template = templates.find((item) => item.id === templateId);
    if (!template && preset !== "blank") {
      toast.error("使用するメールテンプレートを選択してください");
      return;
    }
    setCreating(true);
    try {
      const created = await createAutomation.mutateAsync(
        preset === "blank"
          ? createBlankAutomation(name.trim(), timeZone)
          : { ...createPresetAutomation(name.trim(), preset, template!), timezone: timeZone },
      );
      setCreateOpen(false);
      await navigate({ to: "/automations/$id", params: { id: created.id }, search });
    } catch (error) {
      toast.error(getErrorMessage(error, "オートメーションを作成できません"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <PageLayout
      title="オートメーション"
      action={
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button />}>
            <Plus data-icon="inline-start" />
            フローを作成
            <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  selectPreset("blank");
                  setCreateOpen(true);
                }}
              >
                <Plus />
                空のフローから作成
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  selectPreset(presets[0]!.id);
                  setCreateOpen(true);
                }}
              >
                <GitBranch />
                プリセットから作成
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAiOpen(true)}>
                <Sparkles />
                AIで作成
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSequenceOpen(true)}>
                <Mail />
                AIメールシーケンス
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <AutomationMonitoringTable automations={automations} search={search} />
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
            const nextPreset = values[0] as PresetId | "blank" | undefined;
            if (nextPreset) selectPreset(nextPreset);
          }}
          variant="outline"
          className="grid w-full gap-3 sm:grid-cols-2"
        >
          <ToggleGroupItem
            value="blank"
            aria-label="空のフロー"
            className="h-auto justify-start p-4"
          >
            空のフロー（バッチ・施策・共通フロー）
          </ToggleGroupItem>
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
          {preset !== "blank" ? (
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
          ) : null}
        </FieldGroup>
        {templates.length === 0 && preset !== "blank" ? (
          <p className="text-sm text-destructive">
            先に「メール → テンプレート」で送信内容を作成してください。
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCreateOpen(false)}>
            キャンセル
          </Button>
          <Button
            disabled={creating || !name.trim() || (preset !== "blank" && !templateId)}
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
              await navigate({ to: "/automations/$id", params: { id: created.id }, search });
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
              await navigate({
                to: "/automations/$id",
                params: { id: created.automationId },
                search,
              });
            }}
          />
        ) : null}
      </Suspense>
    </PageLayout>
  );
}
