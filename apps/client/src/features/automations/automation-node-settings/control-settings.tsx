import type { ReactNode } from "react";

import type { AutomationNode } from "@openengage/core/automations";

import { formatDuration } from "../automation-labels";
import { SettingInput, SettingSelect } from "./fields";
import { delayModeIs, nodeTypeIs, patchNodeConfig, type NodeUpdate } from "./node-config";

export function DelaySettings({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "delay" }>;
  onUpdate: NodeUpdate;
}): ReactNode {
  if (node.config.mode !== "relative") {
    return (
      <p className="text-sm text-muted-foreground">相対待機へ変更すると画面で編集できます。</p>
    );
  }
  return (
    <SettingInput
      label="待機時間（分）"
      type="number"
      min={1}
      max={525600}
      value={String(node.config.minutes)}
      description={`${formatDuration(node.config.minutes)} 待ってから次へ進みます。`}
      onChange={(value) =>
        patchNodeConfig(onUpdate, delayModeIs("relative"), () => ({
          minutes: Math.max(1, Number(value) || 1),
        }))
      }
    />
  );
}

export function DecisionSettings({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "decision" }>;
  onUpdate: NodeUpdate;
}): ReactNode {
  return (
    <>
      <SettingSelect
        label="待つ行動"
        value={node.config.event}
        onChange={(value) =>
          patchNodeConfig(onUpdate, nodeTypeIs("decision"), (config) => ({
            event: value as typeof config.event,
          }))
        }
        options={[
          ["opened", "メール開封"],
          ["clicked", "メールクリック"],
          ["replied", "メール返信"],
          ["page_viewed", "ページ閲覧"],
          ["form_submitted", "フォーム送信"],
          ["custom_event", "カスタムイベント"],
        ]}
      />
      <SettingInput
        label={node.config.event === "custom_event" ? "イベント名" : "対象ID（任意）"}
        value={node.config.resourceId ?? ""}
        placeholder={node.config.event === "custom_event" ? "purchase_completed" : "未指定"}
        onChange={(value) =>
          patchNodeConfig(onUpdate, nodeTypeIs("decision"), () => ({
            resourceId: value || undefined,
          }))
        }
      />
      <SettingInput
        label="待機上限（分）"
        type="number"
        min={1}
        max={525600}
        value={String(node.config.withinMinutes)}
        onChange={(value) =>
          patchNodeConfig(onUpdate, nodeTypeIs("decision"), () => ({
            withinMinutes: Math.max(1, Number(value) || 1),
          }))
        }
      />
      <p className="text-xs leading-5 text-muted-foreground">
        行動ありは「はい」、上限到達は「時間切れ」の接続先へ進みます。
      </p>
    </>
  );
}

export function ConditionSettings({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "condition" }>;
  onUpdate: NodeUpdate;
}): ReactNode {
  return (
    <>
      <SettingInput
        label="連絡先フィールド"
        value={node.config.field}
        placeholder="stage"
        onChange={(value) =>
          patchNodeConfig(onUpdate, nodeTypeIs("condition"), () => ({ field: value }))
        }
      />
      <SettingSelect
        label="比較"
        value={node.config.operator}
        onChange={(value) =>
          patchNodeConfig(onUpdate, nodeTypeIs("condition"), (config) => ({
            operator: value as typeof config.operator,
          }))
        }
        options={[
          ["eq", "等しい"],
          ["neq", "等しくない"],
          ["contains", "含む"],
          ["gt", "より大きい"],
          ["gte", "以上"],
          ["lt", "より小さい"],
          ["lte", "以下"],
          ["exists", "値がある"],
          ["not_exists", "値がない"],
        ]}
      />
      <SettingInput
        label="比較する値"
        value={
          typeof node.config.value === "string"
            ? node.config.value
            : String(node.config.value ?? "")
        }
        onChange={(value) => patchNodeConfig(onUpdate, nodeTypeIs("condition"), () => ({ value }))}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        条件一致は「はい」、不一致は「いいえ」の接続先へ進みます。
      </p>
    </>
  );
}
