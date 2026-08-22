import type { ReactNode } from "react";

import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { LandingPageEditorDialog } from "./landing-page-editor-dialog";
import { useLandingPagesController } from "./landing-pages-controller";
import { landingPageColumns, LandingPagesSummary } from "./landing-pages-view";
import { WebsiteResourceListPage } from "./resource-page";

export function LandingPagesPage({ workspaceSlug }: { workspaceSlug: string }): ReactNode {
  const controller = useLandingPagesController(workspaceSlug);
  const { formatDateTime } = useWorkspaceFormatters();
  const editor = controller.editor;
  return (
    <WebsiteResourceListPage
      title="ランディングページ"
      createLabel="ページを作成"
      onCreateClick={editor.openCreate}
      summary={<LandingPagesSummary items={controller.items} />}
      listTitle="ページ一覧"
      listDescription="公開URLと現在のバージョンを管理します。"
      columns={landingPageColumns({
        formatDateTime,
        onEdit: editor.openEdit,
        onArchive: controller.archive,
        publicUrl: controller.publicUrl,
      })}
      rows={controller.items}
      rowKey={(item) => item.id}
      tableCaption="ページ一覧"
      emptyTitle="ランディングページがありません"
      emptyDescription="見出し、本文、CTAを入力して最初のページを作成してください。"
      editor={
        <LandingPageEditorDialog
          key={editor.sessionKey}
          item={editor.editing}
          open={editor.dialogOpen}
          onOpenChange={editor.onOpenChange}
          onSaved={editor.close}
          createMutation={controller.createMutation}
          updateMutation={controller.updateMutation}
        />
      }
    />
  );
}
