import type { ReactNode } from "react";

import { FormInput } from "@/components/app-ui";
import { AppDialog } from "@/components/app-ui/dialogs";
import { Button } from "@/components/ui/button";

import { useLandingPageEditor } from "./landing-editor-controller";
import {
  LandingConversation,
  LandingVersionHistory,
  LandingPreviewPanel,
  LandingPromptForm,
} from "./landing-editor-panels";
import { LandingOptimizationPanel } from "./landing-optimization-panel";
import {
  type LandingPageRow,
  type useCreateLandingPage,
  type useUpdateLandingPage,
} from "./website-api";

export function LandingPageEditorDialog({
  item,
  open,
  onOpenChange,
  onSaved,
  createMutation,
  updateMutation,
}: {
  item: LandingPageRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  createMutation: Pick<ReturnType<typeof useCreateLandingPage>, "mutateAsync">;
  updateMutation: Pick<ReturnType<typeof useUpdateLandingPage>, "mutateAsync">;
}): ReactNode {
  const {
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
  } = useLandingPageEditor({ item, open, createMutation, updateMutation });
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "LPを編集" : "AIでLPを作成"}
      description="目的・対象者・伝えたい内容を入力すると、フォームと計測を含む下書きを作成します。生成中に閉じても処理は続きます。"
      className="sm:max-w-6xl"
    >
      <div className="flex items-end gap-3">
        <FormInput
          form="landing-generation-form"
          name="pageName"
          label="ページ名"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
        />
        {pageId && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || generating || !name.trim() || name.trim() === design.data?.name}
            onClick={() => void saveName()}
          >
            名前を保存
          </Button>
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <LandingConversation jobs={design.data?.jobs ?? []} />
          <LandingPromptForm
            pageId={pageId}
            prompt={prompt}
            onPromptChange={setPrompt}
            busy={busy}
            generating={generating}
            error={error}
            onSubmit={submit}
          />
          <LandingVersionHistory
            versions={design.data?.versions ?? []}
            currentVersionId={design.data?.currentVersionId ?? null}
            publishedVersionId={design.data?.publishedVersionId ?? null}
            disabled={busy || generating}
            onPublish={publishVersion}
          />
        </div>
        <LandingPreviewPanel
          html={design.data?.previewHtml ?? ""}
          mobile={mobile}
          onMobileChange={setMobile}
          disabled={!design.data?.currentVersionId || generating || busy}
          onPublish={() => {
            if (design.data?.currentVersionId) void publishVersion(design.data.currentVersionId);
          }}
        />
      </div>
      {design.data && (
        <LandingOptimizationPanel
          pageId={pageId}
          publishedVersionId={design.data.publishedVersionId}
          versions={design.data.versions}
        />
      )}
      <Button type="button" variant="ghost" onClick={onSaved}>
        閉じる
      </Button>
    </AppDialog>
  );
}
