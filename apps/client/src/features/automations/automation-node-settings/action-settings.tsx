import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
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
