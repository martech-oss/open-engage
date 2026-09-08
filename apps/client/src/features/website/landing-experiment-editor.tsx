import { useState, type FormEvent } from "react";

import { FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import type { Experiment } from "@openengage/core/web";
import type { LandingPageVersion } from "@openengage/core/web";

import { LandingExperimentReport } from "./landing-experiment-report";
import { useCreateExperiment, useStartExperiment, useEndExperiment } from "./optimization-api";

export function ExperimentCreateForm({
  pageId,
  versions,
}: {
  pageId: string;
  versions: LandingPageVersion[];
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [variants, setVariants] = useState([
    { id: "a", name: "A", pageVersionId: versions[0]?.id ?? "", weight: 50 },
    { id: "b", name: "B", pageVersionId: versions[1]?.id ?? "", weight: 50 },
  ]);
  const create = useCreateExperiment();
  const total = variants.reduce((sum, item) => sum + item.weight, 0);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await create.mutateAsync({ id: key, pageId, name, variants });
      setName("");
      setKey(crypto.randomUUID());
    } catch {
      /* shown below */
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <FormInput
        label="比較テスト名"
        name="experimentName"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      {versions.length < 2 ? (
        <p className="text-sm">
          版履歴から2つ以上のページ案を公開して、検証済みの版を選択してください。
        </p>
      ) : null}
      {variants.map((variant, index) => (
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]" key={variant.id}>
          <FormInput
            label={`案 ${index + 1} の名前`}
            name={`variantName${index}`}
            value={variant.name}
            onChange={(event) =>
              setVariants((items) =>
                items.map((item, i) =>
                  i === index ? { ...item, name: event.target.value } : item,
                ),
              )
            }
            required
          />
          <FormNativeSelect
            label="固定するページ版"
            name={`variantVersion${index}`}
            value={variant.pageVersionId}
            onChange={(event) =>
              setVariants((items) =>
                items.map((item, i) =>
                  i === index ? { ...item, pageVersionId: event.target.value } : item,
                ),
              )
            }
            required
          >
            <FormSelectOption value="">版を選択</FormSelectOption>
            {versions.map((version) => (
              <FormSelectOption key={version.id} value={version.id}>
                版 {version.version} · {version.document.title}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
          <FormInput
            label="配分率（%）"
            name={`variantWeight${index}`}
            type="number"
            min={1}
            max={100}
            value={variant.weight}
            onChange={(event) =>
              setVariants((items) =>
                items.map((item, i) =>
                  i === index ? { ...item, weight: Number(event.target.value) } : item,
                ),
              )
            }
            required
          />
          <Button
            type="button"
            variant="ghost"
            disabled={variants.length <= 2}
            onClick={() => setVariants((items) => items.filter((_, i) => i !== index))}
          >
            案を削除
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={variants.length >= 5}
          onClick={() =>
            setVariants((items) => [
              ...items,
              {
                id: `v${crypto.randomUUID().slice(0, 8)}`,
                name: `案 ${items.length + 1}`,
                pageVersionId: "",
                weight: 10,
              },
            ])
          }
        >
          案を追加
        </Button>
        <span>合計 {total}%</span>
        <Button type="submit" disabled={create.isPending || total !== 100 || versions.length < 2}>
          比較テストを作成
        </Button>
      </div>
      {create.error ? (
        <p role="alert" className="text-destructive">
          {create.error.message}
        </p>
      ) : null}
    </form>
  );
}
export function ExperimentCard({
  experiment,
  publishedVersionId,
}: {
  experiment: Experiment;
  publishedVersionId: string | null;
}) {
  const start = useStartExperiment(),
    end = useEndExperiment();
  const [winner, setWinner] = useState("");
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="font-medium">
        {experiment.name} ·{" "}
        {experiment.status === "draft"
          ? "準備中"
          : experiment.status === "running"
            ? "実行中"
            : "終了"}
      </h3>
      <p className="text-sm">
        {experiment.variants.map((variant) => `${variant.name}: ${variant.weight}%`).join(" / ")}
      </p>
      {experiment.status === "draft" ? (
        <Button disabled={start.isPending} onClick={() => start.mutate({ id: experiment.id })}>
          テストを開始
        </Button>
      ) : null}
      {experiment.status === "running" ? (
        <div className="flex flex-wrap items-end gap-3">
          <FormNativeSelect
            label="採用する案"
            name={`winner-${experiment.id}`}
            value={winner}
            onChange={(event) => setWinner(event.target.value)}
          >
            <FormSelectOption value="">採用せず現在の公開版を維持</FormSelectOption>
            {experiment.variants.map((variant) => (
              <FormSelectOption key={variant.id} value={variant.id}>
                {variant.name}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
          <Button
            disabled={end.isPending || !publishedVersionId}
            onClick={() =>
              end.mutate({
                id: experiment.id,
                winnerVariantId: winner || null,
                expectedPublishedVersionId: publishedVersionId!,
              })
            }
          >
            終了する
          </Button>
        </div>
      ) : null}
      {experiment.winnerVariantId ? (
        <p>
          採用案:{" "}
          {experiment.variants.find((variant) => variant.id === experiment.winnerVariantId)?.name}
        </p>
      ) : null}
      {(start.error ?? end.error) ? (
        <p role="alert" className="text-destructive">
          {(start.error ?? end.error)?.message}
        </p>
      ) : null}
      {experiment.status !== "draft" ? <LandingExperimentReport experiment={experiment} /> : null}
    </section>
  );
}
