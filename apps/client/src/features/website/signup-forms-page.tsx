import type { ReactNode } from "react";

import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { WebsiteResourceListPage } from "./resource-page";
import { SignupFormEditorDialog } from "./signup-form-editor-dialog";
import { useSignupFormsController } from "./signup-forms-controller";
import { signupFormColumns, SignupFormsSummary } from "./signup-forms-view";

export function SignupFormsPage({ workspaceSlug }: { workspaceSlug: string }): ReactNode {
  const controller = useSignupFormsController(workspaceSlug);
  const { formatDateTime } = useWorkspaceFormatters();
  const editor = controller.editor;
  return (
    <WebsiteResourceListPage
      title="フォーム"
      createLabel="フォームを作成"
      onCreateClick={editor.openCreate}
      summary={<SignupFormsSummary items={controller.items} />}
      listTitle="フォーム一覧"
      columns={signupFormColumns({
        formatDateTime,
        onEdit: editor.openEdit,
        onArchive: controller.archive,
        publicUrls: controller.publicUrls,
      })}
      rows={controller.items}
      rowKey={(item) => item.id}
      tableCaption="フォーム一覧"
      emptyTitle="サインアップフォームがありません"
      emptyDescription="最初のフォームを作成すると、公開URLから連絡先を獲得できます。"
      editor={
        <SignupFormEditorDialog
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
