import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { assignmentGroupsQueryOptions, salesMembersQueryOptions } from "@/features/deals/sales-api";
import type { AutomationNode } from "@openengage/core/automations";

import { automationExecutionOptionsQueryOptions } from "../automation-api";
import type { AutomationOptions } from "../automation-types";
import { SettingSelect } from "./fields";
import { actionIs, patchNodeConfig, type NodeUpdate } from "./node-config";
import { VariableSetting } from "./variable-setting";

export function ActionSettings({
  node,
  options,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "action" }>;
  options: AutomationOptions;
  onUpdate: NodeUpdate;
}): ReactNode {
  if (
    node.config.action === "call_automation" ||
    node.config.action === "upsert_project_member" ||
    node.config.action === "change_score"
  )
    return <ExecutionActionSettings node={node} onUpdate={onUpdate} />;
  if (node.config.action === "handoff_to_sales")
    return <SalesHandoffSettings config={node.config} onUpdate={onUpdate} />;
  if (node.config.action === "send_email") {
    const config = node.config;
    const selected = options.templates.find((template) => template.id === config.templateId);
    return (
      <>
        <SettingSelect
          label="メールテンプレート"
          value={config.templateId}
          onChange={(value) => {
            const template = options.templates.find((item) => item.id === value);
            if (!template) return;
            patchNodeConfig(onUpdate, actionIs("send_email"), () => ({ templateId: value }));
          }}
          options={options.templates.map((template) => [
            template.id,
            `${template.name}${template.sendable ? "" : template.purpose === "marketing" ? "（Marketing・送信未対応）" : "（未公開）"}`,
          ])}
        />
        {selected ? (
          <div className="flex items-center justify-between gap-2">
            <FieldDescription>
              {selected.purpose === "marketing"
                ? "Marketingメールは現在送信できません。"
                : selected.sendable
                  ? "公開済みのTransactionalテンプレートです。"
                  : "先にメール画面でテンプレートを公開してください。"}
            </FieldDescription>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/emails/templates" />}
            >
              メールを編集
            </Button>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">このアクションはJSON定義で設定されています。</p>
  );
}

function SalesHandoffSettings({
  config,
  onUpdate,
}: {
  config: Extract<
    Extract<AutomationNode, { type: "action" }>["config"],
    { action: "handoff_to_sales" }
  >;
  onUpdate: NodeUpdate;
}) {
  const { data: members = [] } = useQuery(salesMembersQueryOptions());
  const { data: groups = [] } = useQuery(assignmentGroupsQueryOptions());
  return (
    <>
      <SettingSelect
        label="営業担当の割り当て"
        value={
          config.groupId
            ? `group:${config.groupId}`
            : config.ownerUserId
              ? `user:${config.ownerUserId}`
              : "existing"
        }
        options={[
          ["existing", "現在の担当者を使用"],
          ...members.map((member) => [`user:${member.id}`, member.name] as [string, string]),
          ...groups.map((group) => [`group:${group.id}`, group.name] as [string, string]),
        ]}
        onChange={(value) =>
          patchNodeConfig(onUpdate, actionIs("handoff_to_sales"), () => ({
            ownerUserId: value.startsWith("user:") ? value.slice(5) : undefined,
            groupId: value.startsWith("group:") ? value.slice(6) : undefined,
          }))
        }
      />
      <VariableSetting
        label="タスク名"
        type="string"
        value={config.title}
        onChange={(title) =>
          patchNodeConfig(onUpdate, actionIs("handoff_to_sales"), () => ({ title }))
        }
      />
      <SettingSelect
        label="現在の担当者"
        value={config.preserveOwner ? "keep" : "replace"}
        options={[
          ["keep", "有効な担当者を保持"],
          ["replace", "再割り当て"],
        ]}
        onChange={(value) =>
          patchNodeConfig(onUpdate, actionIs("handoff_to_sales"), () => ({
            preserveOwner: value === "keep",
          }))
        }
      />
    </>
  );
}

function ExecutionActionSettings({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "action" }>;
  onUpdate: NodeUpdate;
}) {
  const { data } = useQuery(automationExecutionOptionsQueryOptions());
  const config = node.config;
  if (config.action === "call_automation")
    return (
      <>
        <SettingSelect
          label="呼び出すフロー"
          value={config.automationId}
          options={[
            ["", "フローを選択"],
            ...(data?.callableAutomations.map((item) => [item.id, item.name] as const) ?? []),
          ]}
          onChange={(automationId) =>
            patchNodeConfig(onUpdate, actionIs("call_automation"), () => ({ automationId }))
          }
        />
        <SettingSelect
          label="子フローの実行"
          value={config.mode}
          options={[
            ["await", "完了を待つ（失敗を親に伝える）"],
            ["async", "開始後すぐ次へ進む"],
          ]}
          onChange={(mode) =>
            patchNodeConfig(onUpdate, actionIs("call_automation"), () => ({
              mode: mode === "await" ? ("await" as const) : ("async" as const),
            }))
          }
        />
        <p className="text-xs text-muted-foreground">
          公開時の子フロー版を使います。変更を取り込むには、この親フローを再公開してください。
        </p>
      </>
    );
  if (config.action === "upsert_project_member")
    return (
      <>
        <SettingSelect
          label="登録・更新する施策"
          value={config.projectId}
          options={[
            ["", "施策を選択"],
            ...(data?.projects
              .filter((project) => project.statuses.length)
              .map((project) => [project.id, project.name] as const) ?? []),
          ]}
          onChange={(projectId) =>
            patchNodeConfig(onUpdate, actionIs("upsert_project_member"), () => ({
              projectId,
              statusId: undefined,
            }))
          }
        />
        <SettingSelect
          label="更新先ステータス"
          value={config.statusId ?? ""}
          options={[
            ["", "初期ステータス（登録のみ）"],
            ...(data?.projects
              .find((project) => project.id === config.projectId)
              ?.statuses.map((status) => [status.id, status.name] as const) ?? []),
          ]}
          onChange={(statusId) =>
            patchNodeConfig(onUpdate, actionIs("upsert_project_member"), () => ({
              statusId: statusId || undefined,
            }))
          }
        />
      </>
    );
  if (config.action === "change_score")
    return (
      <>
        <SettingSelect
          label="スコアの対象"
          value={config.categoryId ?? ""}
          options={[
            ["", "全体スコア"],
            ...(data?.scoringCategories.map((category) => [category.id, category.name] as const) ??
              []),
          ]}
          onChange={(categoryId) =>
            patchNodeConfig(onUpdate, actionIs("change_score"), () => ({
              categoryId: categoryId || undefined,
            }))
          }
        />
        <SettingSelect
          label="スコア操作"
          value={config.operation ?? "add"}
          options={[
            ["add", "加算・減算"],
            ["set", "値を設定"],
          ]}
          onChange={(operation) =>
            patchNodeConfig(onUpdate, actionIs("change_score"), () => ({
              operation: operation === "set" ? ("set" as const) : ("add" as const),
            }))
          }
        />
        <VariableSetting
          label="スコア変更量"
          type="number"
          value={config.amount}
          onChange={(amount) =>
            patchNodeConfig(onUpdate, actionIs("change_score"), () => ({ amount }))
          }
        />
      </>
    );
  return null;
}
