import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { CustomRedirectEditorDialog } from "./custom-redirect-editor-dialog";
import { useCustomRedirectsController } from "./custom-redirects-controller";
import { customRedirectColumns, CustomRedirectsSummary } from "./custom-redirects-view";
import { WebsiteResourceListPage } from "./resource-page";

export function CustomRedirectsPage(): ReactNode {
  const controller = useCustomRedirectsController();
  const { formatDateTime } = useWorkspaceFormatters();
  const editor = controller.editor;
  const banner = (
    <Alert>
      <ExternalLink />
      <AlertTitle>広告・SNS・資料に貼るリンクのクリックを計測します</AlertTitle>
      <AlertDescription>
        計測用URLは遷移先へ302で転送します。サイトトラッキング済みのページから遷移した場合は
        <code className="mx-1 text-xs">?oe_v=</code>
        の訪問者IDで連絡先に紐付き、タイムライン・セグメント・スコアに反映されます。
      </AlertDescription>
    </Alert>
  );
  return (
    <WebsiteResourceListPage
      title="計測用リンク"
      createLabel="リンクを作成"
      onCreateClick={editor.openCreate}
      banner={banner}
      summary={<CustomRedirectsSummary items={controller.items} />}
      listTitle="リンク一覧"
      listDescription="計測用URLをコピーして、広告やSNSの遷移先に設定してください。"
      columns={customRedirectColumns({
        workspaceSlug: controller.workspaceSlug,
        formatDateTime,
        onEdit: editor.openEdit,
        onArchive: controller.archive,
      })}
      rows={controller.items}
      rowKey={(item) => item.id}
      tableCaption="リンク一覧"
      emptyTitle="計測用リンクがありません"
      emptyDescription="遷移先URLとスラッグを指定して、最初のリンクを作成してください。"
      editor={
        <CustomRedirectEditorDialog
          key={editor.editing?.id ?? "new"}
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
