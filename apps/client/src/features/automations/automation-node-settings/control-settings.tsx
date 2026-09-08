import type { ReactNode } from "react";

import type { AutomationNode } from "@openengage/core/automations";
import type { SegmentOperator } from "@openengage/core/segments";

import { AutomationFilterEditor } from "../automation-filter-editor";
import { SettingInput, SettingSelect } from "./fields";
import { nodeTypeIs, patchNodeConfig, type NodeUpdate } from "./node-config";
import { VariableSetting } from "./variable-setting";

export function DelaySettings({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNode, { type: "delay" }>;
  onUpdate: NodeUpdate;
}): ReactNode {
  const config = node.config;
  const change = (config: Extract<AutomationNode, { type: "delay" }>["config"]) =>
    onUpdate((current) => (current.type === "delay" ? { ...current, config } : current));
  return (
    <>
      <SettingSelect
        label="待機の方法"
        value={config.mode}
        options={[
          ["relative", "一定時間待つ"],
          ["absolute", "日時まで待つ"],
          ["window", "曜日・時間帯に合わせる"],
        ]}
        onChange={(mode) =>
          change(
            mode === "absolute"
              ? { mode, at: new Date(Date.now() + 3600000).toISOString() }
              : mode === "window"
                ? { mode, minutes: 60, weekdays: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 }
                : { mode: "relative", minutes: 60 },
          )
        }
      />
      {config.mode === "absolute" ? (
        <VariableSetting
          label="待機終了日時"
          type="datetime"
          value={config.at}
          onChange={(at) => change({ ...config, at })}
        />
      ) : (
        <VariableSetting
          label="待機時間（分）"
          type="number"
          value={config.minutes}
          onChange={(minutes) => change({ ...config, minutes })}
        />
      )}
      {config.mode === "window" ? (
        <>
          <SettingInput
            label="開始時刻"
            type="number"
            min={0}
            max={23}
            value={config.startHour}
            onChange={(value) => change({ ...config, startHour: Number(value) })}
          />
          <SettingInput
            label="終了時刻"
            type="number"
            min={1}
            max={24}
            value={config.endHour}
            onChange={(value) => change({ ...config, endHour: Number(value) })}
          />
          <fieldset>
            <legend>曜日</legend>
            {["日", "月", "火", "水", "木", "金", "土"].map((day, index) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={config.weekdays.includes(index)}
                  onChange={(event) =>
                    change({
                      ...config,
                      weekdays: event.target.checked
                        ? [...config.weekdays, index]
                        : config.weekdays.filter((day) => day !== index),
                    })
                  }
                />
                {day}
              </label>
            ))}
          </fieldset>
        </>
      ) : null}
    </>
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
      <VariableSetting
        label="待機上限（分）"
        type="number"
        value={node.config.withinMinutes}
        onChange={(withinMinutes) =>
          patchNodeConfig(onUpdate, nodeTypeIs("decision"), () => ({ withinMinutes }))
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
  const config = node.config;
  if ("filter" in config)
    return (
      <AutomationFilterEditor
        value={config.filter}
        onChange={(filter) =>
          onUpdate((current) =>
            current.type === "condition" ? { ...current, config: { filter } } : current,
          )
        }
      />
    );
  return (
    <>
      <button
        type="button"
        className="text-sm underline"
        onClick={() =>
          onUpdate((current) =>
            current.type === "condition"
              ? {
                  ...current,
                  config: {
                    filter: { kind: "condition", field: "status", operator: "eq", value: "active" },
                  },
                }
              : current,
          )
        }
      >
        会社・商談・行動・施策条件を追加
      </button>
      <SettingInput
        label="連絡先フィールド"
        value={config.field}
        placeholder="stage"
        onChange={(value) =>
          patchNodeConfig(onUpdate, nodeTypeIs("condition"), () => ({ field: value }))
        }
      />
      <SettingSelect
        label="比較"
        value={config.operator}
        onChange={(value) =>
          patchNodeConfig(onUpdate, nodeTypeIs("condition"), () => ({
            operator: value as SegmentOperator,
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
        value={typeof config.value === "string" ? config.value : String(config.value ?? "")}
        onChange={(value) => patchNodeConfig(onUpdate, nodeTypeIs("condition"), () => ({ value }))}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        条件一致は「はい」、不一致は「いいえ」の接続先へ進みます。
      </p>
    </>
  );
}
