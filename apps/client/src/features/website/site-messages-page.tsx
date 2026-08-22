import { Link as LinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { WebsiteResourceListPage } from "./resource-page";
import { SiteMessageEditorDialog } from "./site-message-editor-dialog";
import { useSiteMessagesController } from "./site-messages-controller";
import { siteMessageColumns, SiteMessagesSummary } from "./site-messages-view";

export function SiteMessagesPage(): ReactNode {
  const controller = useSiteMessagesController();
  const { formatDateTime } = useWorkspaceFormatters();
  const editor = controller.editor;
  const banner = (
    <Alert>
      <LinkIcon />
      <AlertTitle>サイトトラッキングと連動します</AlertTitle>
      <AlertDescription>
        許可ドメインで識別された連絡先にのみ表示します。匿名の訪問者には表示しません。
      </AlertDescription>
    </Alert>
  );
  return (
    <WebsiteResourceListPage
      title="サイトメッセージ"
      createLabel="メッセージを作成"
      onCreateClick={editor.openCreate}
      banner={banner}
      summary={<SiteMessagesSummary items={controller.items} />}
      listTitle="メッセージ一覧"
      listDescription="公開状態、ページ条件、表示・クリック実績を確認できます。"
      columns={siteMessageColumns({
        formatDateTime,
        onEdit: editor.openEdit,
        onArchive: controller.archive,
      })}
      rows={controller.items}
      rowKey={(item) => item.id}
      tableCaption="メッセージ一覧"
      emptyTitle="サイトメッセージがありません"
      emptyDescription="ページ条件と表示期間を指定して、最初のメッセージを作成してください。"
      editor={
        <SiteMessageEditorDialog
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
