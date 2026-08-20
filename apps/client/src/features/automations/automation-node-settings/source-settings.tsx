import type { ReactNode } from "react";

import type { AutomationNode } from "@openengage/core/automations";

import { sourceConfig } from "../automation-graph";
import type { AutomationOptions } from "../automation-types";
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
      {"reentry" in node.config &&
      node.config.source !== "contact_created" &&
      node.config.source !== "contact_inactive" ? (
        <SettingSelect
          label="再登録"
          value={node.config.reentry}
          onChange={(value) =>
            onUpdate((current) => {
              if (
                current.type !== "source" ||
                current.config.source === "contact_created" ||
                current.config.source === "contact_inactive"
              )
                return current;
              return {
                ...current,
                config: {
                  ...current.config,
                  reentry: value === "every_time" ? "every_time" : "once",
                },
              };
            })
          }
          options={[
            ["once", "連絡先ごとに1回"],
            ["every_time", "イベントのたびに登録"],
          ]}
        />
      ) : null}
    </>
  );
}
