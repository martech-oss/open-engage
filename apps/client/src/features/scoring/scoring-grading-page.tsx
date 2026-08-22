import { GraduationCap } from "lucide-react";
import type { ReactNode } from "react";

import { PageLayout } from "@/components/app-ui";
import { DataTable } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { gradeLetter } from "@openengage/core/scoring";

import { gradingCriterionColumns, scoringCategoryColumns } from "./scoring-columns";
import { GradingCriterionEditorShell, ScoringCategoryCardShell } from "./scoring-editor-shells";
import { useScoringGradingController } from "./scoring-grading-controller";

export function ScoringGradingPage(): ReactNode {
  const controller = useScoringGradingController();
  const columns = gradingCriterionColumns(
    controller.criterionEditor.openEdit,
    controller.archiveCriterion,
  );
  const categoryColumns = scoringCategoryColumns(controller.archiveCategory);
  return (
    <PageLayout
      title="グレードとカテゴリ"
      action={<Button onClick={controller.criterionEditor.openCreate}>グレード条件を追加</Button>}
    >
      <Alert>
        <GraduationCap />
        <AlertTitle>グレードは基準のDから3分の1文字ずつ動きます</AlertTitle>
        <AlertDescription>
          有効な条件をすべて満たすと現在は
          <strong className="mx-1">{gradeLetter(controller.summary.totalSteps)}</strong>
          になります。行動を測るスコアに対し、グレードは属性の合致度を表します。
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>グレード条件</CardTitle>
          <CardDescription>
            連絡先の属性が条件に合致するたび、グレードを指定分だけ上下させます。
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            columns={columns}
            rows={controller.criteria}
            rowKey={(item) => item.id}
            caption="グレード条件一覧"
            emptyTitle="グレード条件がありません"
            emptyDescription="役職や業種などの属性条件を追加すると、連絡先にA〜Fのグレードが付きます。"
          />
        </CardContent>
      </Card>
      <ScoringCategoryCardShell
        key={controller.categoryEditor.sessionId}
        categories={controller.categories}
        columns={categoryColumns}
        open={controller.categoryEditor.dialogOpen}
        onOpenChange={controller.categoryEditor.onOpenChange}
      />
      <GradingCriterionEditorShell
        key={controller.criterionEditor.sessionId}
        item={controller.criterionEditor.editing}
        open={controller.criterionEditor.dialogOpen}
        onOpenChange={controller.criterionEditor.onOpenChange}
        onSaved={controller.criterionEditor.close}
      />
    </PageLayout>
  );
}
