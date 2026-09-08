import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  FormTextarea,
} from "@/components/app-ui/form-fields";
import { Button } from "@/components/ui/button";
import { variablesQueryOptions } from "@/features/projects/variable-api";
import { VariableProjectField } from "@/features/projects/variable-project-field";
import { useFormSubmission } from "@/hooks/use-form-submission";
import type { LandingPageDocument, LandingPageVersion } from "@openengage/core/web";

import type { useLandingPageEditor } from "./landing-editor-controller";
import type { useUpdateLandingPage } from "./website-api";
export function LandingVariableEditor({
  pageId,
  name,
  slug,
  version,
  updateMutation,
  onSaved,
}: {
  pageId: string;
  name: string;
  slug: string;
  version: LandingPageVersion;
  updateMutation: Pick<ReturnType<typeof useUpdateLandingPage>, "mutateAsync">;
  onSaved: () => Promise<unknown>;
}) {
  const [document, setDocument] = useState<LandingPageDocument>(version.document);
  const vars = useQuery(variablesQueryOptions(document.variableProjectId ?? null));
  const { busy, error, run } = useFormSubmission("変数の設定を保存できませんでした");
  const update = (changes: Partial<LandingPageDocument>) =>
    setDocument((current) => ({ ...current, ...changes }));
  const save = () =>
    run(async () => {
      await updateMutation.mutateAsync({
        id: pageId,
        name,
        slug,
        status: "draft",
        baseVersionId: version.id,
        document,
      });
      await onSaved();
    });
  return (
    <details className="space-y-3 rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">表示文・CTA・変数</summary>
      <div className="mt-3 space-y-3">
        <VariableProjectField
          value={document.variableProjectId ?? null}
          onChange={(variableProjectId) => update({ variableProjectId })}
          disabled={busy}
        />
        <p className="text-sm text-muted-foreground">
          表示文で {"{{variables.key}}"}{" "}
          を使用できます。HTML内では本文に挿入してください。URLはCTAの変数欄で指定します。保存後に下書きを公開すると反映されます。
        </p>
        <p className="text-sm">
          使用可能:{" "}
          {vars.data?.effective.values.map((value) => `${value.key} (${value.type})`).join(", ") ||
            "なし"}
        </p>
        <FormInput
          name="variablePageTitle"
          label="表示タイトル"
          value={document.title}
          onChange={(event) => update({ title: event.target.value })}
        />
        <FormTextarea
          name="variableDescription"
          label="ページ説明"
          value={document.description}
          onChange={(event) => update({ description: event.target.value })}
        />
        <FormTextarea
          name="variableHtml"
          label="HTML本文"
          rows={8}
          value={document.html}
          onChange={(event) => update({ html: event.target.value })}
        />
        {document.ctas.map((cta, index) => (
          <div key={cta.refId} className="grid gap-2 rounded border p-3 sm:grid-cols-2">
            <FormInput
              name={`cta-label-${cta.refId}`}
              label={`CTA ${cta.refId} の表示文`}
              value={cta.label}
              onChange={(event) =>
                update({
                  ctas: document.ctas.map((item, i) =>
                    i === index ? { ...item, label: event.target.value } : item,
                  ),
                })
              }
            />
            <FormNativeSelect
              name={`cta-variable-${cta.refId}`}
              label={`CTA ${cta.refId} のURL変数`}
              value={cta.hrefVariable?.key ?? ""}
              onChange={(event) =>
                update({
                  ctas: document.ctas.map((item, i) => {
                    if (i !== index) return item;
                    const { hrefVariable: _, ...literal } = item;
                    return event.target.value
                      ? {
                          ...literal,
                          hrefVariable: { kind: "variable", key: event.target.value, type: "url" },
                        }
                      : literal;
                  }),
                })
              }
            >
              <FormSelectOption value="">固定URLを使用</FormSelectOption>
              {vars.data?.effective.values
                .filter((value) => value.type === "url")
                .map((value) => (
                  <FormSelectOption key={value.key} value={value.key}>
                    {value.key}
                  </FormSelectOption>
                ))}
              {cta.hrefVariable &&
                !vars.data?.effective.values.some(
                  (value) => value.key === cta.hrefVariable?.key,
                ) && (
                  <FormSelectOption value={cta.hrefVariable.key}>
                    {cta.hrefVariable.key}（未定義）
                  </FormSelectOption>
                )}
            </FormNativeSelect>
          </div>
        ))}
        <Button type="button" disabled={busy} onClick={() => void save()}>
          表示文と変数設定を下書き保存
        </Button>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}

export function LandingVariablePanel({
  design,
  pageId,
  name,
  updateMutation,
}: {
  design: ReturnType<typeof useLandingPageEditor>["design"];
  pageId: string;
  name: string;
  updateMutation: Pick<ReturnType<typeof useUpdateLandingPage>, "mutateAsync">;
}) {
  const version = design.data?.versions.find((item) => item.id === design.data?.currentVersionId);
  return version && design.data ? (
    <LandingVariableEditor
      key={version.id}
      pageId={pageId}
      name={name}
      slug={design.data.slug}
      version={version}
      updateMutation={updateMutation}
      onSaved={() => design.refetch()}
    />
  ) : null;
}
