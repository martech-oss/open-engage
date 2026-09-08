import { Target } from "lucide-react";
import type { ReactNode } from "react";

import { PageLayout } from "@/components/app-ui";
import { DataTable } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { scoringRuleColumns } from "./scoring-columns";
import { ScoringRuleEditorShell } from "./scoring-editor-shells";
import { useScoringRulesController } from "./scoring-rules-controller";
import { ScoringRulesSummary } from "./scoring-summaries";

export function ScoringRulesPage(): ReactNode {
  const controller = useScoringRulesController();
  const columns = scoringRuleColumns(controller.editor.openEdit, controller.archive);
  return (
    <PageLayout
      title="スコアリングルール"
      action={<Button onClick={controller.editor.openCreate}>ルールを作成</Button>}
    >
      <Alert>
        <Target />
        <AlertTitle>ページ閲覧のルールはPage Actionとして働きます</AlertTitle>
        <AlertDescription>
          イベントに「ページ閲覧」を選び、URLの一致条件を指定すると、特定ページを見た連絡先に
          自動で加点・タグ付けできます。計測にはサイトトラッキングの有効化が必要です。
        </AlertDescription>
      </Alert>
      <ScoringRulesSummary summary={controller.summary} />
      <Card>
        <CardHeader>
          <CardTitle>ルール一覧</CardTitle>
          <CardDescription>
            一致したルールの点数を合算し、全体スコアとカテゴリ別スコアに反映します。
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            columns={columns}
            pagination={controller.pagination}
            rows={controller.rules}
            rowKey={(item) => item.id}
            caption="スコアリングルール一覧"
            emptyTitle="ルールがありません"
            emptyDescription="行動と点数を決めて、最初のルールを作成してください。"
          />
        </CardContent>
      </Card>
      <ScoringRuleEditorShell
        key={controller.editor.sessionId}
        item={controller.editor.editing}
        open={controller.editor.dialogOpen}
        onOpenChange={controller.editor.onOpenChange}
        onSaved={controller.editor.close}
      />
    </PageLayout>
  );
}
