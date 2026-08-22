import { Layers } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { ArchiveConfirm, FormDialog, FormInput } from "@/components/app-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getFormString } from "@/lib/form-data";

import type { ScoringCategoryRow } from "./scoring-api";
import { useScoringCategoryEditorController } from "./scoring-editor-controllers";

export function CategoryCard({
  categories,
  open,
  onOpenChange,
  onArchive,
}: {
  categories: ScoringCategoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (item: ScoringCategoryRow) => Promise<void>;
}): ReactNode {
  const controller = useScoringCategoryEditorController(() => onOpenChange(false));
  const columns: DataTableColumn<ScoringCategoryRow>[] = [
    { key: "name", header: "カテゴリ", cell: (item) => item.name },
    {
      key: "slug",
      header: "スラッグ",
      cell: (item) => <code className="text-xs">{item.slug}</code>,
    },
    {
      key: "actions",
      header: "操作",
      cell: (item) => (
        <div className="flex justify-end">
          <ArchiveConfirm
            label={item.name}
            description={`「${item.name}」を削除すると、このカテゴリを参照するルールは全体スコアのみに戻ります。`}
            onConfirm={() => onArchive(item)}
          />
        </div>
      ),
      headClassName: "text-right",
    },
  ];
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void controller.save({ name: getFormString(form, "name"), slug: getFormString(form, "slug") });
  }
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
        onSubmit={submit}
        busy={controller.busy}
        error={controller.error}
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
