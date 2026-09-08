import type { ReactNode } from "react";

import type { AutomationNode } from "@openengage/core/automations";

import { sourceConfig } from "../automation-graph";
import type { AutomationOptions } from "../automation-types";
import { BatchSourceSettings, ProjectSourceSettings } from "./batch-settings";
import { SettingInput, SettingSelect } from "./fields";
import { patchNodeConfig, sourceIs, type NodeUpdate } from "./node-config";

export function SourceSettings({
  node,
  options,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "source" }>;
  options: AutomationOptions;
  onUpdate: NodeUpdate;
}): ReactNode {
  const source = node.config.source;
  return (
    <>
      <SettingSelect
        label="開始条件"
        value={source}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "source"
              ? {
                  ...current,
                  config: sourceConfig(
                    value,
                    options.forms[0]?.id ?? "",
                    options.segments[0]?.id ?? "",
                  ),
                }
              : current,
          )
        }
        options={[
          ["batch", "バッチ（対象者をまとめて登録）"],
          ["callable", "他のフローから呼び出す"],
          ["project_member_joined", "施策に参加した"],
          ["project_member_progressed", "施策のステータスが進んだ"],
          ["project_member_succeeded", "施策の成果に到達した"],
          ["contact_created", "連絡先が登録された"],
          ["form_submitted", "フォームが送信された"],
          ["segment_joined", "セグメントに参加した"],
          ["api_event", "APIイベントを受け取った"],
          ["webhook_event", "Webhookイベントを受け取った"],
          ["contact_inactive", "一定期間行動がない"],
        ]}
      />
      {source === "form_submitted" ? (
        <SettingSelect
          label="フォーム"
          value={node.config.formId}
          onChange={(value) =>
            patchNodeConfig(onUpdate, sourceIs("form_submitted"), () => ({ formId: value }))
          }
          options={options.forms.map((form) => [form.id, form.name])}
        />
      ) : null}
      {source === "segment_joined" ? (
        <SettingSelect
          label="セグメント"
          value={node.config.segmentId}
          onChange={(value) =>
            patchNodeConfig(onUpdate, sourceIs("segment_joined"), () => ({ segmentId: value }))
          }
          options={options.segments.map((segment) => [segment.id, segment.name])}
        />
      ) : null}
      {source === "api_event" || source === "webhook_event" ? (
        <SettingInput
          label="イベント名"
          value={node.config.eventName}
          placeholder="cart_abandoned"
          description="連絡先イベントAPIまたはサイトトラッキングから送る名前です。"
          onChange={(value) =>
            onUpdate((current) =>
              current.type === "source" &&
              (current.config.source === "api_event" || current.config.source === "webhook_event")
                ? { ...current, config: { ...current.config, eventName: value } }
                : current,
            )
          }
        />
      ) : null}
      {source === "contact_inactive" ? (
        <SettingInput
          label="行動がない日数"
          type="number"
          min={1}
          max={3650}
          value={String(node.config.days)}
          onChange={(value) =>
            patchNodeConfig(onUpdate, sourceIs("contact_inactive"), () => ({
              days: Math.max(1, Number(value) || 1),
            }))
          }
        />
      ) : null}
      {source === "batch" ? <BatchSourceSettings config={node.config} onUpdate={onUpdate} /> : null}
      {"projectId" in node.config ? (
        <ProjectSourceSettings
          projectId={node.config.projectId}
          onChange={(projectId) =>
            onUpdate((current) =>
              current.type === "source" && "projectId" in current.config
                ? { ...current, config: { ...current.config, projectId } }
                : current,
            )
          }
        />
      ) : null}
      {source !== "callable" ? (
        <>
          <SettingSelect
            label="再登録"
            value={node.config.reentry}
            options={[
              ["once", "連絡先ごとに1回"],
              ["every_time", "イベントのたびに登録"],
              ["cooldown", "一定時間後に再登録"],
            ]}
            onChange={(value) =>
              onUpdate((current) =>
                current.type === "source"
                  ? {
                      ...current,
                      config: {
                        ...current.config,
                        reentry: value as typeof current.config.reentry,
                        ...(value === "cooldown"
                          ? { cooldownMinutes: current.config.cooldownMinutes ?? 60 }
                          : {}),
                      },
                    }
                  : current,
              )
            }
          />
          {node.config.reentry === "cooldown" ? (
            <SettingInput
              label="再登録までの時間（分）"
              type="number"
              min={1}
              value={node.config.cooldownMinutes ?? 60}
              onChange={(value) =>
                onUpdate((current) =>
                  current.type === "source"
                    ? { ...current, config: { ...current.config, cooldownMinutes: Number(value) } }
                    : current,
                )
              }
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            最後の参加開始から数え、公開版を変更しても引き継ぎます。
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          親の連絡先・施策文脈を継承し、呼び出しごとに1回実行します。
        </p>
      )}
    </>
  );
}
