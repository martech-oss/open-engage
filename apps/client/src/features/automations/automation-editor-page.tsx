import { Pause, Play, RotateCcw, Save, Send, Sparkles, TriangleAlert } from "lucide-react";
import { lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { validateAutomation } from "@openengage/core/automations";

import {
  usePublishAutomationDraft,
  useSaveAutomationDraft,
  useSetAutomationStatus,
} from "./automation-api";
import { AutomationStatusBadge } from "./automation-status-badge";
import type { AutomationDraft, AutomationOptions } from "./automation-types";

const AutomationFlowCanvas = lazy(() => import("./automation-flow-canvas"));
const AutomationAiSheet = lazy(async () => ({
  default: (await import("./automation-ai-sheet")).AutomationAiSheet,
}));

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
  const [definition, setDefinition] = useState(initialDraft.graph);
  const [status, setStatus] = useState(initialDraft.status);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [undoDefinition, setUndoDefinition] = useState<typeof definition | null>(null);
  const templateIssues = useMemo(() => {
    const byId = new Map(options.templates.map((template) => [template.id, template]));
    return definition.nodes.flatMap((node) => {
      if (node.type !== "action" || node.config.action !== "send_email") return [];
      const template = byId.get(node.config.templateId);
      if (!template) return ["参照しているメールテンプレートが見つかりません"];
      if (template.purpose === "marketing") {
        return [`メールテンプレート「${template.name}」はMarketing送信未対応です`];
      }
      if (!template.sendable) return [`メールテンプレート「${template.name}」が未公開です`];
      return [];
    });
  }, [definition.nodes, options.templates]);
  const graphIssues = useMemo(
    () => validateAutomation(definition).map((issue) => issue.message),
    [definition],
  );
  const blockingIssues = [...new Set([...graphIssues, ...templateIssues])];

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
            onChange={(event) => setDefinition({ ...definition, name: event.target.value })}
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AutomationStatusBadge status={status} />
            <span>{definition.timezone}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notice ? (
            <span aria-live="polite" className="max-w-72 text-sm text-muted-foreground">
              {notice}
            </span>
          ) : null}
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
                setDefinition(undoDefinition);
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
          <Button
            disabled={saving || blockingIssues.length > 0}
            title={blockingIssues[0]}
            onClick={() => void save(true)}
          >
            <Send data-icon="inline-start" />
            公開
          </Button>
        </div>
      </div>
      {blockingIssues.length > 0 ? (
        <Alert variant="default" className="m-4 lg:mx-8">
          <TriangleAlert />
          <AlertTitle>公開前の対応が必要です</AlertTitle>
          <AlertDescription>{blockingIssues.join(" / ")}</AlertDescription>
        </Alert>
      ) : null}
      <Suspense
        fallback={
          <div className="grid h-[calc(100vh-8.5rem)] min-h-[600px] place-items-center bg-muted/60">
            <Spinner />
          </div>
        }
      >
        <AutomationFlowCanvas
          definition={definition}
          options={options}
          onDefinitionChange={setDefinition}
        />
      </Suspense>
      <Suspense fallback={null}>
        {aiOpen ? (
          <AutomationAiSheet
            open
            onOpenChange={setAiOpen}
            mode="refine"
            entityId={id}
            currentDefinition={definition}
            onApply={async (nextDefinition) => {
              setUndoDefinition(definition);
              setDefinition(nextDefinition);
              setAiOpen(false);
              toast.success("AIの提案をキャンバスに適用しました。保存前に内容を確認してください");
            }}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
