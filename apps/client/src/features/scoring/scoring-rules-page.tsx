import { useSuspenseQuery } from "@tanstack/react-query";
import { Gauge, Pencil, Tag as TagIcon, Target } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
  ArchiveConfirm,
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  MetricCard,
  MetricGrid,
  PageLayout,
} from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { contactOptionsQueryOptions } from "@/features/contacts/contact-api";
import {
  scoringCategoriesQueryOptions,
  scoringRulesQueryOptions,
  type ScoringRuleRow,
  useArchiveScoringRule,
  useCreateScoringRule,
  useUpdateScoringRule,
} from "@/features/scoring/scoring-api";
import {
  matchValueLabel,
  SCORING_EVENT_LABELS,
  SCORING_MATCH_LABELS,
} from "@/features/scoring/scoring-labels";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource, useResourceEditor } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";
import { SCORING_EVENT_TYPES, SCORING_MATCH_TYPES } from "@openengage/core/scoring";

export function ScoringRulesPage(): ReactNode {
  const { data: rules } = useSuspenseQuery(scoringRulesQueryOptions());
  const { data: categories } = useSuspenseQuery(scoringCategoriesQueryOptions());
  const { dialogOpen, editing, openCreate, openEdit, close, onOpenChange } =
    useResourceEditor<ScoringRuleRow>();
  const archiveRule = useArchiveScoringRule();

  async function archive(item: ScoringRuleRow): Promise<void> {
    try {
      await archiveRule.mutateAsync({ id: item.id });
      toast.success("ルールをアーカイブしました");
    } catch (error) {
      toast.error(getErrorMessage(error, "アーカイブできませんでした"));
    }
  }

  const columns: DataTableColumn<ScoringRuleRow>[] = [
    {
      key: "name",
      header: "ルール",
      cell: (item) => (
        <div className="flex max-w-80 flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">
            {SCORING_EVENT_LABELS[item.eventType]} ・ {SCORING_MATCH_LABELS[item.matchType]}
            {item.matchValue ? `「${item.matchValue}」` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "points",
      header: "点数",
      cell: (item) => (
        <span className={item.points < 0 ? "text-destructive" : undefined}>
          {item.points > 0 ? `+${item.points}` : item.points}
        </span>
      ),
      headClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
    {
      key: "category",
      header: "カテゴリ",
      cell: (item) =>
        item.categoryName ? (
          <Badge variant="secondary">{item.categoryName}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">全体スコアのみ</span>
        ),
    },
    {
      key: "tag",
      header: "タグ付与",
      cell: (item) =>
        item.tagName ? (
          <Badge variant="outline">{item.tagName}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
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
            onClick={() => openEdit(item)}
          >
            <Pencil />
          </Button>
          <ArchiveConfirm
            label={item.name}
            description={`「${item.name}」は以後のイベントで加点しなくなります。過去のスコアはそのまま残ります。`}
            onConfirm={() => archive(item)}
          />
        </div>
      ),
      headClassName: "text-right",
    },
  ];

  const pageRules = rules.filter((rule) => rule.eventType === "page_viewed").length;
  return (
    <PageLayout
      title="スコアリングルール"
      action={<Button onClick={openCreate}>ルールを作成</Button>}
    >
      <Alert>
        <Target />
        <AlertTitle>ページ閲覧のルールはPage Actionとして働きます</AlertTitle>
        <AlertDescription>
          イベントに「ページ閲覧」を選び、URLの一致条件を指定すると、特定ページを見た連絡先に
          自動で加点・タグ付けできます。計測にはサイトトラッキングの有効化が必要です。
        </AlertDescription>
      </Alert>
      <MetricGrid>
        <MetricCard
          label="ルール"
          value={rules.length.toLocaleString()}
          description={
            <div className="flex items-center gap-2 text-sm">
              <Gauge />
              有効 {rules.filter((rule) => rule.enabled).length.toLocaleString()} 件
            </div>
          }
        />
        <MetricCard
          label="Page Action"
          value={pageRules.toLocaleString()}
          description={
            <div className="flex items-center gap-2 text-sm">
              <Target />
              ページ閲覧を条件にしたルール
            </div>
          }
        />
        <MetricCard
          label="カテゴリ"
          value={categories.length.toLocaleString()}
          description={
            <div className="flex items-center gap-2 text-sm">
              <TagIcon />
              製品・関心別のスコア軸
            </div>
          }
        />
      </MetricGrid>
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
            rows={rules}
            rowKey={(item) => item.id}
            caption="スコアリングルール一覧"
            emptyTitle="ルールがありません"
            emptyDescription="行動と点数を決めて、最初のルールを作成してください。"
          />
        </CardContent>
      </Card>
      <ScoringRuleEditor
        key={editing?.id ?? "new"}
        item={editing}
        open={dialogOpen}
        onOpenChange={onOpenChange}
        onSaved={close}
      />
    </PageLayout>
  );
}

function ScoringRuleEditor({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: ScoringRuleRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}): ReactNode {
  const { data: categories } = useSuspenseQuery(scoringCategoriesQueryOptions());
  const { data: contactOptions } = useSuspenseQuery(contactOptionsQueryOptions());
  const [matchType, setMatchType] = useState(item?.matchType ?? "any");
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  const createRule = useCreateScoringRule();
  const updateRule = useUpdateScoringRule();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const matchValue = getFormString(formData, "matchValue").trim();
    const categoryId = getFormString(formData, "categoryId");
    const tagId = getFormString(formData, "tagId");
    const payload = {
      name: getFormString(formData, "name"),
      eventType: getFormString(formData, "eventType") as ScoringRuleRow["eventType"],
      matchType: getFormString(formData, "matchType") as ScoringRuleRow["matchType"],
      matchValue: matchValue || null,
      points: Number(getFormString(formData, "points")) || 0,
      categoryId: categoryId || null,
      tagId: tagId || null,
      enabled: getFormString(formData, "enabled") !== "disabled",
    } as const;
    await run(() =>
      saveResource({
        editing: item,
        payload,
        create: (data) => createRule.mutateAsync(data),
        update: (id, data) => updateRule.mutateAsync({ id, ...data }),
        createdMessage: "ルールを作成しました",
        updatedMessage: "ルールを更新しました",
        onSaved,
      }),
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "スコアリングルールを編集" : "スコアリングルールを作成"}
      description="対象の行動と、一致したときに動かす点数・タグを設定します。"
      className="sm:max-w-2xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "ルールを作成"}
    >
      <FormInput
        label="ルール名"
        name="name"
        defaultValue={item?.name}
        placeholder="料金ページを閲覧"
        required
      />
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormNativeSelect
          label="対象の行動"
          name="eventType"
          defaultValue={item?.eventType ?? "page_viewed"}
        >
          {SCORING_EVENT_TYPES.map((type) => (
            <FormSelectOption key={type} value={type}>
              {SCORING_EVENT_LABELS[type]}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect
          label="一致条件"
          name="matchType"
          defaultValue={item?.matchType ?? "any"}
          onChange={(event) =>
            setMatchType(event.currentTarget.value as ScoringRuleRow["matchType"])
          }
        >
          {SCORING_MATCH_TYPES.map((type) => (
            <FormSelectOption key={type} value={type}>
              {SCORING_MATCH_LABELS[type]}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </FieldGroup>
      {matchType === "any" ? null : (
        <FormInput
          label={matchValueLabel(matchType)}
          name="matchValue"
          defaultValue={item?.matchValue ?? ""}
          description={
            matchType === "resource"
              ? "フォームID、計測用リンクID、カスタムイベント名などを指定します。"
              : "計測されたページURLと突き合わせます。"
          }
          placeholder={matchType === "resource" ? "019f..." : "/pricing"}
          required
        />
      )}
      <FieldGroup className="grid gap-4 sm:grid-cols-3">
        <FormInput
          label="点数"
          name="points"
          type="number"
          defaultValue={item?.points ?? 5}
          description="マイナスも指定できます。"
          required
        />
        <FormNativeSelect label="カテゴリ" name="categoryId" defaultValue={item?.categoryId ?? ""}>
          <FormSelectOption value="">全体スコアのみ</FormSelectOption>
          {categories.map((category) => (
            <FormSelectOption key={category.id} value={category.id}>
              {category.name}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect label="タグを付与" name="tagId" defaultValue={item?.tagId ?? ""}>
          <FormSelectOption value="">付与しない</FormSelectOption>
          {contactOptions.tags.map((tag) => (
            <FormSelectOption key={tag.id} value={tag.id}>
              {tag.name}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
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
