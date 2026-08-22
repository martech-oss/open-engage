import { Layers } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { FormInput } from "@/components/app-ui";
import { FormDialog } from "@/components/app-ui/dialogs";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { ScoringCategoryRow } from "./scoring-api";

export type CategoryCardViewProps = {
  categories: ScoringCategoryRow[];
  columns: DataTableColumn<ScoringCategoryRow>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string;
};

export function CategoryCardView({
  categories,
  columns,
  open,
  onOpenChange,
  onSubmit,
  busy,
  error,
}: CategoryCardViewProps): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>スコアリングカテゴリ</CardTitle>
        <CardDescription>
          製品や関心ごとにスコアを分けたいときに使います。ルールでカテゴリを選ぶと、全体スコアと同時にカテゴリ別スコアも動きます。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="px-6">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(true)}>
            <Layers data-icon="inline-start" />
            カテゴリを追加
          </Button>
        </div>
        <DataTable
          columns={columns}
          rows={categories}
          rowKey={(item) => item.id}
          caption="スコアリングカテゴリ一覧"
          emptyTitle="カテゴリがありません"
          emptyDescription="製品別・関心別にスコアを分けたい場合に作成してください。"
        />
      </CardContent>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="スコアリングカテゴリを作成"
        description="ルールから参照するスコアの軸です。"
        onSubmit={onSubmit}
        busy={busy}
        error={error}
        submitLabel="カテゴリを作成"
      >
        <FormInput label="名前" name="name" placeholder="製品A" required />
        <FormInput
          label="スラッグ"
          name="slug"
          description="英小文字、数字、ハイフンのみ。"
          placeholder="product-a"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
        />
      </FormDialog>
    </Card>
  );
}
