import { useSuspenseQuery } from "@tanstack/react-query";
import { GraduationCap, Layers, Pencil } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
  ArchiveConfirm,
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  PageLayout,
} from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import {
  gradingCriteriaQueryOptions,
  type GradingCriterionRow,
  scoringCategoriesQueryOptions,
  type ScoringCategoryRow,
  useArchiveGradingCriterion,
  useArchiveScoringCategory,
  useCreateGradingCriterion,
  useCreateScoringCategory,
  useUpdateGradingCriterion,
} from "@/features/scoring/scoring-api";
import { GRADING_FIELD_LABELS, GRADING_OPERATOR_LABELS } from "@/features/scoring/scoring-labels";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource, useResourceEditor } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";
import { gradeLetter, GRADING_FIELDS, GRADING_OPERATORS } from "@openengage/core/scoring";

export function ScoringGradingPage(): ReactNode {
  const { data: criteria } = useSuspenseQuery(gradingCriteriaQueryOptions());
  const { data: categories } = useSuspenseQuery(scoringCategoriesQueryOptions());
  const criterionEditor = useResourceEditor<GradingCriterionRow>();
  const archiveCriterion = useArchiveGradingCriterion();
  const archiveCategory = useArchiveScoringCategory();

  const total = criteria
    .filter((criterion) => criterion.enabled)
    .reduce((sum, criterion) => sum + criterion.steps, 0);

  async function removeCriterion(item: GradingCriterionRow): Promise<void> {
    try {
      await archiveCriterion.mutateAsync({ id: item.id });
      toast.success("グレード条件を削除しました");
    } catch (error) {
      toast.error(getErrorMessage(error, "削除できませんでした"));
    }
  }

  async function removeCategory(item: ScoringCategoryRow): Promise<void> {
    try {
      await archiveCategory.mutateAsync({ id: item.id });
      toast.success("カテゴリを削除しました");
    } catch (error) {
      toast.error(getErrorMessage(error, "削除できませんでした"));
    }
  }

  const criterionColumns: DataTableColumn<GradingCriterionRow>[] = [
    {
      key: "name",
      header: "条件",
      cell: (item) => (
        <div className="flex max-w-80 flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">
            {GRADING_FIELD_LABELS[item.field] ?? item.field}
            {item.fieldKey ? `（${item.fieldKey}）` : ""} が{" "}
            {GRADING_OPERATOR_LABELS[item.operator]}
            {item.value ? `「${item.value}」` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "steps",
      header: "移動量",
      cell: (item) => (
        <span className={item.steps < 0 ? "text-destructive" : undefined}>
          {item.steps > 0 ? `+${item.steps}` : item.steps} / 3文字
        </span>
      ),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "enabled",
      header: "状態",
      cell: (item) => (
        <Badge variant={item.enabled ? "default" : "secondary"}>
          {item.enabled ? "有効" : "停止中"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "操作",
      cell: (item) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${item.name}を編集`}
            onClick={() => criterionEditor.openEdit(item)}
          >
            <Pencil />
          </Button>
          <ArchiveConfirm
            label={item.name}
            description={`「${item.name}」を削除すると、以後のグレード再計算で評価されなくなります。`}
            onConfirm={() => removeCriterion(item)}
          />
        </div>
      ),
      headClassName: "text-right",
    },
  ];

  const categoryColumns: DataTableColumn<ScoringCategoryRow>[] = [
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
            onConfirm={() => removeCategory(item)}
          />
        </div>
      ),
      headClassName: "text-right",
    },
  ];

  return (
    <PageLayout
      title="グレードとカテゴリ"
      action={<Button onClick={criterionEditor.openCreate}>グレード条件を追加</Button>}
    >
      <Alert>
        <GraduationCap />
        <AlertTitle>グレードは基準のDから3分の1文字ずつ動きます</AlertTitle>
        <AlertDescription>
          有効な条件をすべて満たすと現在は
          <strong className="mx-1">{gradeLetter(total)}</strong>
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
            columns={criterionColumns}
            rows={criteria}
            rowKey={(item) => item.id}
            caption="グレード条件一覧"
            emptyTitle="グレード条件がありません"
            emptyDescription="役職や業種などの属性条件を追加すると、連絡先にA〜Fのグレードが付きます。"
          />
        </CardContent>
      </Card>
      <CategoryCard columns={categoryColumns} categories={categories} />
      <GradingCriterionEditor
        key={criterionEditor.editing?.id ?? "new"}
        item={criterionEditor.editing}
        open={criterionEditor.dialogOpen}
        onOpenChange={criterionEditor.onOpenChange}
        onSaved={criterionEditor.close}
      />
    </PageLayout>
  );
}

function CategoryCard({
  columns,
  categories,
}: {
  columns: DataTableColumn<ScoringCategoryRow>[];
  categories: ScoringCategoryRow[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  const createCategory = useCreateScoringCategory();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await run(async () => {
      await createCategory.mutateAsync({
        name: getFormString(formData, "name"),
        slug: getFormString(formData, "slug"),
      });
      toast.success("カテゴリを作成しました");
      setOpen(false);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>スコアリングカテゴリ</CardTitle>
        <CardDescription>
          製品や関心ごとにスコアを分けたいときに使います。ルールでカテゴリを選ぶと、
          全体スコアと同時にカテゴリ別スコアも動きます。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="px-6">
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
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
        onOpenChange={setOpen}
        title="スコアリングカテゴリを作成"
        description="ルールから参照するスコアの軸です。"
        onSubmit={(event) => void submit(event)}
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

function GradingCriterionEditor({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: GradingCriterionRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}): ReactNode {
  const [field, setField] = useState(item?.field ?? "custom_field");
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  const createCriterion = useCreateGradingCriterion();
  const updateCriterion = useUpdateGradingCriterion();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const fieldKey = getFormString(formData, "fieldKey").trim();
    const payload = {
      name: getFormString(formData, "name"),
      field: getFormString(formData, "field") as GradingCriterionRow["field"],
      fieldKey: fieldKey || null,
      operator: getFormString(formData, "operator") as GradingCriterionRow["operator"],
      value: getFormString(formData, "value"),
      steps: Number(getFormString(formData, "steps")) || 0,
      enabled: getFormString(formData, "enabled") !== "disabled",
    } as const;
    await run(() =>
      saveResource({
        editing: item,
        payload,
        create: (data) => createCriterion.mutateAsync(data),
        update: (id, data) => updateCriterion.mutateAsync({ id, ...data }),
        createdMessage: "グレード条件を作成しました",
        updatedMessage: "グレード条件を更新しました",
        onSaved,
      }),
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "グレード条件を編集" : "グレード条件を追加"}
      description="連絡先の属性がこの条件に合致すると、グレードを上下させます。"
      className="sm:max-w-2xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "条件を追加"}
    >
      <FormInput
        label="条件名"
        name="name"
        defaultValue={item?.name}
        placeholder="意思決定者の役職"
        required
      />
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormNativeSelect
          label="対象フィールド"
          name="field"
          defaultValue={item?.field ?? "custom_field"}
          onChange={(event) => setField(event.currentTarget.value as GradingCriterionRow["field"])}
        >
          {GRADING_FIELDS.map((value) => (
            <FormSelectOption key={value} value={value}>
              {GRADING_FIELD_LABELS[value] ?? value}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect
          label="演算子"
          name="operator"
          defaultValue={item?.operator ?? "contains"}
        >
          {GRADING_OPERATORS.map((value) => (
            <FormSelectOption key={value} value={value}>
              {GRADING_OPERATOR_LABELS[value]}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </FieldGroup>
      {field === "custom_field" ? (
        <FormInput
          label="カスタムフィールドのキー"
          name="fieldKey"
          defaultValue={item?.fieldKey ?? ""}
          placeholder="job_title"
          required
        />
      ) : null}
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="値"
          name="value"
          defaultValue={item?.value ?? ""}
          description="「値がある / ない」を選んだ場合は空欄で構いません。"
          placeholder="部長"
        />
        <FormInput
          label="移動量（3分の1文字）"
          name="steps"
          type="number"
          min={-6}
          max={6}
          defaultValue={item?.steps ?? 1}
          description="+3 で1文字ぶん上がります。"
          required
        />
      </FieldGroup>
      <FormNativeSelect
        label="状態"
        name="enabled"
        defaultValue={item && !item.enabled ? "disabled" : "enabled"}
      >
        <FormSelectOption value="enabled">有効</FormSelectOption>
        <FormSelectOption value="disabled">停止中</FormSelectOption>
      </FormNativeSelect>
    </FormDialog>
  );
}
