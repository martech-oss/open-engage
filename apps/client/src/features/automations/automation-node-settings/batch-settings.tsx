import { useQuery } from "@tanstack/react-query";

import type { AutomationNode, AutomationSchedule } from "@openengage/core/automations";

import {
  automationStaticListsQueryOptions,
  automationExecutionOptionsQueryOptions,
} from "../automation-api";
import { AutomationFilterEditor } from "../automation-filter-editor";
import { DateTimeSetting } from "./datetime-setting";
import { SettingInput, SettingSelect } from "./fields";
import { patchNodeConfig, sourceIs, type NodeUpdate } from "./node-config";
type BatchConfig = Extract<
  Extract<AutomationNode, { type: "source" }>["config"],
  { source: "batch" }
>;
export function BatchSourceSettings({
  config,
  onUpdate,
}: {
  config: BatchConfig;
  onUpdate: NodeUpdate;
}) {
  const { data: lists = [] } = useQuery(automationStaticListsQueryOptions());
  const update = (patch: Partial<BatchConfig>) =>
    patchNodeConfig(onUpdate, sourceIs("batch"), () => patch);
  const schedule = config.schedule;
  const setSchedule = (schedule: AutomationSchedule) => update({ schedule });
  return (
    <>
      <SettingSelect
        label="対象者の選び方"
        value={config.audience.kind}
        options={[
          ["filter", "条件で選ぶ"],
          ["segment", "リストから選ぶ"],
        ]}
        onChange={(kind) =>
          update({
            audience:
              kind === "segment"
                ? { kind: "segment", segmentId: lists[0]?.id ?? "" }
                : {
                    kind: "filter",
                    filter: { kind: "condition", field: "status", operator: "eq", value: "active" },
                  },
          })
        }
      />
      {config.audience.kind === "segment" ? (
        <SettingSelect
          label="対象リスト"
          value={config.audience.segmentId}
          options={lists.map((list) => [list.id, list.name])}
          onChange={(segmentId) => update({ audience: { kind: "segment", segmentId } })}
        />
      ) : (
        <AutomationFilterEditor
          value={config.audience.filter}
          onChange={(filter) => update({ audience: { kind: "filter", filter } })}
        />
      )}
      <SettingSelect
        label="実行予定"
        value={schedule.kind}
        options={[
          ["now", "今すぐ（手動実行）"],
          ["once", "日時指定"],
          ["daily", "毎日"],
          ["weekly", "毎週"],
          ["monthly", "毎月"],
        ]}
        onChange={(kind) =>
          setSchedule(
            kind === "now"
              ? { kind }
              : kind === "once"
                ? { kind, at: new Date(Date.now() + 3600000).toISOString() }
                : kind === "weekly"
                  ? { kind, weekdays: [1], hour: 9, minute: 0 }
                  : kind === "monthly"
                    ? { kind, day: 1, hour: 9, minute: 0 }
                    : { kind: "daily", hour: 9, minute: 0 },
          )
        }
      />
      {schedule.kind === "once" ? (
        <DateTimeSetting
          label="実行日時"
          value={schedule.at}
          onChange={(at) => setSchedule({ ...schedule, at })}
        />
      ) : null}
      {"hour" in schedule ? (
        <div className="grid grid-cols-2 gap-2">
          <SettingInput
            label="時"
            type="number"
            min={0}
            max={23}
            value={schedule.hour}
            onChange={(hour) => setSchedule({ ...schedule, hour: Number(hour) })}
          />
          <SettingInput
            label="分"
            type="number"
            min={0}
            max={59}
            value={schedule.minute}
            onChange={(minute) => setSchedule({ ...schedule, minute: Number(minute) })}
          />
        </div>
      ) : null}
      {schedule.kind === "weekly" ? (
        <fieldset>
          <legend className="text-sm">曜日</legend>
          <div className="flex flex-wrap gap-2">
            {["日", "月", "火", "水", "木", "金", "土"].map((day, index) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={schedule.weekdays.includes(index)}
                  onChange={(event) =>
                    setSchedule({
                      ...schedule,
                      weekdays: event.target.checked
                        ? [...schedule.weekdays, index]
                        : schedule.weekdays.filter((value) => value !== index),
                    })
                  }
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {schedule.kind === "monthly" ? (
        <SettingInput
          label="日（存在しない日は月末）"
          type="number"
          min={1}
          max={31}
          value={schedule.day}
          onChange={(day) => setSchedule({ ...schedule, day: Number(day) })}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        フローのタイムゾーンで実行します。夏時間で存在しない時刻はスキップし、重複する時刻は最初の1回を実行します。
      </p>
    </>
  );
}
export function ProjectSourceSettings({
  projectId,
  onChange,
}: {
  projectId: string;
  onChange: (id: string) => void;
}) {
  const { data } = useQuery(automationExecutionOptionsQueryOptions());
  return (
    <SettingSelect
      label="施策"
      value={projectId}
      options={[
        ["", "施策を選択"],
        ...(data?.projects.map((project) => [project.id, project.name] as const) ?? []),
      ]}
      onChange={onChange}
    />
  );
}
