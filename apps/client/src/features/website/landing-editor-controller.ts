import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { useFormSubmission } from "@/hooks/use-form-submission";
import { emptyLandingPageDocument } from "@openengage/core/web";

import {
  landingPageDesignQueryOptions,
  type LandingPageRow,
  type useCreateLandingPage,
  type useUpdateLandingPage,
  useGenerateLandingPage,
  usePublishLandingPage,
} from "./website-api";

export function useLandingPageEditor({
  item,
  open,
  createMutation,
  updateMutation,
}: {
  item: LandingPageRow | null;
  open: boolean;
  createMutation: Pick<ReturnType<typeof useCreateLandingPage>, "mutateAsync">;
  updateMutation: Pick<ReturnType<typeof useUpdateLandingPage>, "mutateAsync">;
}) {
  const [pageId, setPageId] = useState(item?.id ?? ""),
    [name, setName] = useState(item?.name ?? ""),
    [prompt, setPrompt] = useState(""),
    [mobile, setMobile] = useState(false);
  const { busy, error, run } = useFormSubmission("ページを更新できませんでした");
  const generate = useGenerateLandingPage(),
    publish = usePublishLandingPage();
  const design = useQuery({
    ...landingPageDesignQueryOptions(pageId),
    enabled: Boolean(pageId) && open,
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => job.status === "queued" || job.status === "running")
        ? 2000
        : false,
  });
  const generating =
    design.data?.jobs.some((job) => job.status === "queued" || job.status === "running") ?? false;
  async function saveMetadata() {
    const current = design.data?.versions.find(
      (version) => version.id === design.data.currentVersionId,
    );
    if (!current || !design.data) throw new Error("下書きを読み込み直してください");
    if (name.trim() === design.data.name) return current.id;
    const updated = await updateMutation.mutateAsync({
      id: pageId,
      name: name.trim(),
      slug: design.data.slug,
      status: "draft",
      document: current.document,
      baseVersionId: current.id,
    });
    await design.refetch();
    return updated.versionId;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    await run(async () => {
      let id = pageId,
        baseVersionId = design.data?.currentVersionId;
      if (!id) {
        const created = await createMutation.mutateAsync({
          name: name.trim() || "新しいページ",
          status: "draft",
          document: emptyLandingPageDocument(name.trim() || "新しいページ"),
        });
        id = created.id;
        baseVersionId = created.versionId;
        setPageId(id);
      } else baseVersionId = await saveMetadata();
      if (!baseVersionId) throw new Error("下書きを読み込み直してください");
      await generate.mutateAsync({
        pageId: id,
        baseVersionId,
        prompt: prompt.trim(),
        requestKey: crypto.randomUUID(),
      });
      setPrompt("");
      if (pageId) await design.refetch();
    });
  }
  async function publishVersion(versionId: string) {
    if (!design.data?.currentVersionId) return;
    await run(async () => {
      const previous = design.data!.currentVersionId;
      const baseVersionId = await saveMetadata();
      await publish.mutateAsync({
        id: pageId,
        versionId: versionId === previous ? baseVersionId : versionId,
        baseVersionId,
      });
      toast.success("ページを公開しました");
      await design.refetch();
    });
  }
  const saveName = () =>
    run(async () => {
      await saveMetadata();
      toast.success("名前を保存しました");
    });
  return {
    pageId,
    name,
    setName,
    prompt,
    setPrompt,
    mobile,
    setMobile,
    busy,
    error,
    generating,
    design,
    submit,
    publishVersion,
    saveName,
  };
}
