import { useState } from "react";

import { useWorkspaceFormatters, useWorkspaceTime } from "@/lib/workspace-time";

import { SettingInput } from "./fields";

export function DateTimeSetting({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { timeZone } = useWorkspaceTime(),
    { toDateTimeLocal, fromDateTimeLocal } = useWorkspaceFormatters();
  const [editing, setEditing] = useState<{ emitted: string; local: string; error: boolean } | null>(
    null,
  );
  return (
    <div className="space-y-1">
      <SettingInput
        label={label}
        type="datetime-local"
        value={editing?.emitted === value ? editing.local : toDateTimeLocal(value)}
        onChange={(local) => {
          let emitted = "",
            error = false;
          try {
            emitted = fromDateTimeLocal(local);
          } catch {
            error = true;
          }
          setEditing({ emitted, local, error });
          onChange(emitted);
        }}
      />
      <p className="text-xs text-muted-foreground">{timeZone} の日時</p>
      {editing?.emitted === value && editing.error ? (
        <p role="alert" className="text-sm text-destructive">
          有効な日時を入力してください。夏時間で存在しない時刻は指定できません。
        </p>
      ) : null}
    </div>
  );
}
