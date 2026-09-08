import { useQuery } from "@tanstack/react-query";

import type { LandingPageVersion } from "@openengage/core/web";

import { LandingDynamicEditor } from "./landing-dynamic-editor";
import { ExperimentCreateForm, ExperimentCard } from "./landing-experiment-editor";
import { experimentsQueryOptions } from "./optimization-api";
export function LandingOptimizationPanel({
  pageId,
  publishedVersionId,
  versions,
}: {
  pageId: string;
  publishedVersionId: string | null;
  versions: LandingPageVersion[];
}) {
  const { data: experiments = [], error } = useQuery(experimentsQueryOptions(pageId));
  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border p-4">
        <h2 className="text-lg font-medium">ページ案の比較</h2>
        <p className="text-sm text-muted-foreground">
          開始時にページ版を固定します。フォーム送信成功を訪問者単位で数え、初回表示から30日間追跡します。同意がない閲覧は集計しません。終了と採用案の決定は手動です。
        </p>
        <ExperimentCreateForm
          pageId={pageId}
          versions={versions.filter((version) => version.publishedAt)}
        />
        {experiments.map((experiment) => (
          <ExperimentCard
            key={experiment.id}
            experiment={experiment}
            publishedVersionId={publishedVersionId}
          />
        ))}
        {error ? <p role="alert">{error.message}</p> : null}
      </section>
      <LandingDynamicEditor pageId={pageId} slots={versions[0]?.document.dynamicSlots ?? []} />
    </div>
  );
}
