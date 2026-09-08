import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { FormInput, FormTextarea, FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import type { DynamicContentWrite } from "@openengage/core/web";

import {
  dynamicContentsQueryOptions,
  optimizationSegmentOptions,
  useSaveDynamicContent,
} from "./optimization-api";

export function LandingDynamicEditor({
  pageId,
  slots,
}: {
  pageId: string;
  slots: Array<{ refId: string; fallbackHtml: string }>;
}) {
  const { data: contents = [], isPending, error } = useQuery(dynamicContentsQueryOptions(pageId));
  const { data: segments = [] } = useQuery(optimizationSegmentOptions());
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-medium">表示内容の出し分け</h2>
      <p className="text-sm text-muted-foreground">
        優先順位の小さいルールから判定し、最初に一致した内容を表示します。未識別・条件不一致の訪問者には既定表示を使います。
      </p>
      {!slots.length ? (
        <p className="text-sm">
          AIへの修正依頼で、出し分ける箇所と既定の表示内容を指定してください。
        </p>
      ) : null}
      {!isPending
        ? slots.map((slot) => {
            const current = contents.find((content) => content.slotId === slot.refId);
            return (
              <DynamicSlotEditor
                key={`${slot.refId}-${current?.updatedAt ?? "initial"}`}
                input={
                  current ?? {
                    pageId,
                    slotId: slot.refId,
                    fallbackHtml: slot.fallbackHtml,
                    rules: [],
                  }
                }
                segments={segments}
              />
            );
          })
        : null}
      {error ? <p role="alert">{error.message}</p> : null}
    </section>
  );
}
function DynamicSlotEditor({
  input,
  segments,
}: {
  input: DynamicContentWrite;
  segments: Array<{ id: string; name: string }>;
}) {
  const [fallbackHtml, setFallback] = useState(input.fallbackHtml),
    [rules, setRules] = useState(input.rules);
  const save = useSaveDynamicContent();
  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ ...input, fallbackHtml, rules });
  }
  const change = (id: string, patch: Partial<DynamicContentWrite["rules"][number]>) =>
    setRules((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  return (
    <form onSubmit={submit} className="space-y-3 border-t pt-4">
      <h3 className="font-medium">表示箇所: {input.slotId}</h3>
      <FormTextarea
        label="既定表示（HTML）"
        name={`fallback-${input.slotId}`}
        value={fallbackHtml}
        onChange={(event) => setFallback(event.target.value)}
        rows={3}
      />
      {rules.map((rule) => (
        <div className="space-y-2 rounded border p-3" key={rule.id}>
          <div className="grid gap-2 sm:grid-cols-2">
            <FormNativeSelect
              label="対象セグメント"
              name={`segment-${rule.id}`}
              value={rule.segmentId}
              onChange={(event) => change(rule.id, { segmentId: event.target.value })}
              required
            >
              <FormSelectOption value="">選択してください</FormSelectOption>
              {segments.map((segment) => (
                <FormSelectOption key={segment.id} value={segment.id}>
                  {segment.name}
                </FormSelectOption>
              ))}
            </FormNativeSelect>
            <FormInput
              label="優先順位（小さい順）"
              name={`priority-${rule.id}`}
              type="number"
              min={0}
              max={1000}
              value={rule.priority}
              onChange={(event) => change(rule.id, { priority: Number(event.target.value) })}
              required
            />
          </div>
          <FormTextarea
            label="条件一致時の表示内容（HTML）"
            name={`html-${rule.id}`}
            value={rule.html}
            onChange={(event) => change(rule.id, { html: event.target.value })}
            rows={3}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRules((items) => items.filter((item) => item.id !== rule.id))}
          >
            ルールを削除
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={rules.length >= 30}
          onClick={() =>
            setRules((items) => [
              ...items,
              { id: crypto.randomUUID(), segmentId: "", priority: items.length * 10, html: "" },
            ])
          }
        >
          ルールを追加
        </Button>
        <Button type="submit" disabled={save.isPending}>
          表示ルールを保存
        </Button>
      </div>
      {save.error ? (
        <p role="alert" className="text-destructive">
          {save.error.message}
        </p>
      ) : null}
    </form>
  );
}
