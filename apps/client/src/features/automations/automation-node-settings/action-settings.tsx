import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { assignmentGroupsQueryOptions, salesMembersQueryOptions } from "@/features/deals/sales-api";
import type { AutomationNode } from "@openengage/core/automations";

import type { AutomationOptions } from "../automation-types";
import { SettingInput, SettingSelect } from "./fields";
import { actionIs, patchNodeConfig, type NodeUpdate } from "./node-config";

export function ActionSettings({
  node,
  options,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "action" }>;
  options: AutomationOptions;
  onUpdate: NodeUpdate;
}): ReactNode {
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
  if (node.config.action === "change_score") {
    return (
      <SettingInput
        label="スコア変更量"
        type="number"
        value={String(node.config.amount)}
        onChange={(value) =>
          patchNodeConfig(onUpdate, actionIs("change_score"), () => ({
            amount: Number(value) || 0,
          }))
        }
      />
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
      <SettingInput
        label="タスク名"
        value={config.title}
        onChange={(value) =>
          patchNodeConfig(onUpdate, actionIs("handoff_to_sales"), () => ({ title: value }))
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
