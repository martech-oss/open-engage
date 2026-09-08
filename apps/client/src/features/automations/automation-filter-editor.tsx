import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { SegmentBuilder } from "@/features/segments/segment-builder";
import { mapSegmentDateValues } from "@/features/segments/segment-builder-model";
import { useWorkspaceFormatters, useWorkspaceTime } from "@/lib/workspace-time";
import type { SegmentFilter } from "@openengage/core/segments";
import { workspaceDateTimeToUtc } from "@openengage/core/shared/time";

import { automationFilterCatalogQueryOptions } from "./automation-api";
export function AutomationFilterEditor({
  value,
  onChange,
}: {
  value: SegmentFilter;
  onChange: (value: SegmentFilter) => void;
}) {
  const { data, error } = useQuery(automationFilterCatalogQueryOptions());
  const { timeZone } = useWorkspaceTime(),
    { toDateTimeLocal } = useWorkspaceFormatters();
  const [editing, setEditing] = useState<{
    emitted: SegmentFilter;
    draft: SegmentFilter;
    error: string | null;
  } | null>(null);
  if (error) return <p role="alert">条件の選択肢を取得できませんでした。</p>;
  if (!data) return <p>条件を読み込み中…</p>;
  return (
    <div className="space-y-2">
      <SegmentBuilder
        value={
          editing?.emitted === value
            ? editing.draft
            : mapSegmentDateValues(value, data, toDateTimeLocal)
        }
        catalog={data}
        defaults={{ dateTimeLocal: toDateTimeLocal(new Date().toISOString()) }}
        onChange={(next) => {
          let error: string | null = null;
          const emitted = mapSegmentDateValues(next, data, (date) => {
            try {
              return workspaceDateTimeToUtc(date, timeZone);
            } catch {
              error = "有効な日時を入力してください。夏時間で存在しない時刻は指定できません。";
              return "";
            }
          });
          // Keep incomplete local input visible; the empty stored date blocks validation
          // rather than silently publishing the preceding valid condition.
          setEditing({ emitted, draft: next, error });
          onChange(emitted);
        }}
      />
      {editing?.emitted === value && editing.error ? (
        <p role="alert" className="text-sm text-destructive">
          {editing.error}
        </p>
      ) : null}
    </div>
  );
}
