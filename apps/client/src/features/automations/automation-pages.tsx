import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Background, Controls, MiniMap, Panel, ReactFlow } from "@xyflow/react";
import {
  Clock3,
  GitBranch,
  Mail,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AppDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  PageLayout,
  SimpleEmpty,
} from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  automationsQueryOptions,
  useCreateAutomation,
  usePublishAutomationDraft,
  useSaveAutomationDraft,
  useSetAutomationStatus,
} from "@/features/automations/automation-api";
import { emailTemplateOptionsQueryOptions } from "@/features/emails/email-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { formatDateTime } from "@/lib/format";
import { RESOURCE_STATUS_LABELS } from "@/lib/status-labels";
import type { AutomationRow } from "@openengage/core/automations";

import { AutomationAiSheet } from "./automation-ai-sheet";
import { automationNodeTypes, StepButton } from "./automation-flow-node";
import { triggerLabel } from "./automation-labels";
import { NodeSettings } from "./automation-node-settings";
import { createPresetAutomation, type PresetId, presets } from "./automation-presets";
import { type AutomationDraft, type AutomationOptions } from "./automation-types";
import { useAutomationBuilder } from "./use-automation-builder";

export type {
  AutomationOptions,
  AutomationDraft,
  AutomationRow,
  EmailTemplateOption,
} from "./automation-types";

export function AutomationsPage(): ReactNode {
  const navigate = useNavigate();
  const { data: automations } = useSuspenseQuery(automationsQueryOptions());
  const { data: allTemplates } = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const templates = useMemo(
    () => allTemplates.filter((template) => template.sendable),
    [allTemplates],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
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
      const definition = createPresetAutomation(name.trim(), preset, template);
      const created = await createAutomation.mutateAsync(definition);
      setCreateOpen(false);
      await navigate({
        to: "/automations/$id",
        params: { id: created.id },
      });
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
      <div className="max-w-3xl text-sm leading-6 text-muted-foreground">
        顧客の登録、フォーム送信、購入やカゴ落ちなどの行動をきっかけに、
        メール送信・待機・条件分岐を自動で実行します。
      </div>
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
      <AutomationAiSheet
        open={aiOpen}
        onOpenChange={setAiOpen}
        mode="create"
        onApply={async (definition) => {
          const created = await createAutomation.mutateAsync(definition);
          setAiOpen(false);
          await navigate({ to: "/automations/$id", params: { id: created.id } });
        }}
      />
    </PageLayout>
  );
}

export function AutomationBuilder({
  id,
  initialDraft,
  options,
}: {
  id: string;
  initialDraft: AutomationDraft;
  options: AutomationOptions;
}): ReactNode {
  const saveDraft = useSaveAutomationDraft();
  const publishDraft = usePublishAutomationDraft();
  const setAutomationStatus = useSetAutomationStatus();
  const builder = useAutomationBuilder(initialDraft.graph);
  const { definition, selectedNode, flowNodes, flowEdges } = builder;
  const [status, setStatus] = useState(initialDraft.status);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [undoDefinition, setUndoDefinition] = useState<typeof definition | null>(null);

  function addNode(kind: "email" | "delay" | "decision" | "condition"): void {
    const result = builder.addNode(kind, options);
    if (result === "template_missing") {
      toast.error("先にメールテンプレートを作成してください");
      return;
    }
    toast.success(
      result === "connected" ? "ステップを追加して接続しました" : "ステップを追加しました",
    );
  }

  async function save(publish = false): Promise<void> {
    setSaving(true);
    setNotice("");
    try {
      await saveDraft.mutateAsync({ id, ...definition });
      if (publish) {
        await publishDraft.mutateAsync({ id });
        setStatus("active");
        setNotice("公開しました。以降の行動イベントから自動登録されます。");
        toast.success("オートメーションを公開しました");
      } else {
        setNotice("下書きを保存しました");
        toast.success("下書きを保存しました");
      }
    } catch (error) {
      const message = getErrorMessage(error, "保存できませんでした");
      setNotice(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(): Promise<void> {
    const nextStatus = status === "active" ? "paused" : "active";
    try {
      await setAutomationStatus.mutateAsync({ id, status: nextStatus });
      setStatus(nextStatus);
      toast.success(nextStatus === "active" ? "再開しました" : "一時停止しました");
    } catch (error) {
      toast.error(getErrorMessage(error, "更新できませんでした"));
    }
  }

  return (
    <div className="-m-4 lg:-m-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-5 py-4 lg:px-8">
        <div className="min-w-64">
          <Input
            aria-label="オートメーション名"
            className="h-auto border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
            value={definition.name}
            onChange={(event) =>
              builder.replaceDefinition({ ...definition, name: event.target.value })
            }
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AutomationStatusBadge status={status} />
            <span>{definition.timezone}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notice ? <span className="max-w-72 text-sm text-muted-foreground">{notice}</span> : null}
          {status === "active" || status === "paused" ? (
            <Button variant="outline" disabled={saving} onClick={() => void changeStatus()}>
              {status === "active" ? (
                <Pause data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {status === "active" ? "一時停止" : "再開"}
            </Button>
          ) : null}
          {undoDefinition ? (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                builder.replaceDefinition(undoDefinition);
                setUndoDefinition(null);
                toast.success("AI適用前の状態に戻しました");
              }}
            >
              <RotateCcw data-icon="inline-start" />
              AI変更を元に戻す
            </Button>
          ) : null}
          <Button variant="outline" disabled={saving} onClick={() => setAiOpen(true)}>
            <Sparkles data-icon="inline-start" />
            AIで編集
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => void save()}>
            <Save data-icon="inline-start" />
            保存
          </Button>
          <Button disabled={saving} onClick={() => void save(true)}>
            <Send data-icon="inline-start" />
            公開
          </Button>
        </div>
      </div>
      <div className="grid h-[calc(100vh-8.5rem)] min-h-[600px] grid-cols-[64px_minmax(0,1fr)] bg-muted/60 lg:grid-cols-[180px_minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-2 border-r bg-background p-2 lg:p-3">
          <div className="hidden px-1 pb-1 text-xs font-medium text-muted-foreground lg:block">
            ステップを追加
          </div>
          <StepButton icon={Mail} label="メール" onClick={() => addNode("email")} />
          <StepButton icon={Clock3} label="待機" onClick={() => addNode("delay")} />
          <StepButton
            icon={MousePointerClick}
            label="行動を待つ"
            onClick={() => addNode("decision")}
          />
          <StepButton icon={GitBranch} label="条件分岐" onClick={() => addNode("condition")} />
        </div>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={automationNodeTypes}
          onNodesChange={builder.onNodesChange}
          onEdgesChange={builder.onEdgesChange}
          onConnect={(connection) => {
            if (builder.connect(connection)) toast.success("ノードを接続しました");
            else toast.error("循環する接続は作成できません");
          }}
          onNodeClick={(_, node) => builder.selectNode(node.id)}
          onPaneClick={() => builder.selectNode(null)}
          fitView
          deleteKeyCode={null}
        >
          <Background color="var(--color-border)" gap={24} />
          <Panel position="top-center">
            <Badge variant="secondary" className="shadow-sm">
              右端の丸から、次のノードの左端の丸へドラッグして接続
            </Badge>
          </Panel>
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
        <div className="hidden overflow-y-auto border-l bg-background lg:block">
          <NodeSettings
            node={selectedNode}
            nodes={definition.nodes}
            edges={definition.edges}
            options={options}
            onUpdate={(update) => {
              if (selectedNode) builder.updateNode(selectedNode.id, update);
            }}
            onConnectionChange={(sourceId, branch, targetId) => {
              if (!builder.setConnection(sourceId, branch, targetId)) {
                toast.error("循環する接続は作成できません");
                return;
              }
              toast.success(targetId ? "接続先を更新しました" : "接続を解除しました");
            }}
            onDelete={builder.deleteSelectedNode}
          />
        </div>
      </div>
      <AutomationAiSheet
        open={aiOpen}
        onOpenChange={setAiOpen}
        mode="refine"
        currentDefinition={definition}
        onApply={async (nextDefinition) => {
          setUndoDefinition(definition);
          builder.replaceDefinition(nextDefinition);
          setAiOpen(false);
          toast.success("AIの提案をキャンバスに適用しました。保存前に内容を確認してください");
        }}
      />
    </div>
  );
}

function AutomationStatusBadge({ status }: { status: AutomationRow["status"] }): ReactNode {
  return (
    <Badge variant={status === "active" ? "default" : "secondary"}>
      {status === "active" ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {RESOURCE_STATUS_LABELS[status]}
    </Badge>
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
