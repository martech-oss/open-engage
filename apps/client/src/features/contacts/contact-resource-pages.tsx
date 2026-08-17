import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Plus, Tags } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { FormDialog, FormInput, PageLayout } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  contactResourcesQueryOptions,
  createContactTag,
  type ContactResources,
} from "@/features/contacts/contact-resource-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";

export function ContactTagsPage(): ReactNode {
  const { data: resources } = useSuspenseQuery(contactResourcesQueryOptions());
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const columns: DataTableColumn<ContactResources["tags"][number]>[] = [
    {
      key: "tag",
      header: "タグ",
      cell: (tag) => (
        <Badge variant="outline">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
        </Badge>
      ),
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "color",
      header: "カラー",
      cell: (tag) => (
        <span className="font-mono text-xs text-muted-foreground">{tag.color.toUpperCase()}</span>
      ),
    },
    {
      key: "slug",
      header: "スラッグ",
      cell: (tag) => <span className="font-mono text-xs text-muted-foreground">{tag.slug}</span>,
    },
    {
      key: "contactCount",
      header: "連絡先",
      cell: (tag) => <Badge variant="secondary">{Number(tag.contactCount).toLocaleString()}</Badge>,
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right",
    },
  ];

  return (
    <PageLayout
      title="タグ"
      action={
        <Button onClick={() => setShowCreate(true)}>
          <Plus data-icon="inline-start" />
          タグを作成
        </Button>
      }
    >
      <Card>
        <CardHeader className="border-b">
          <CardTitle>すべてのタグ</CardTitle>
          <CardAction>
            <Badge variant="secondary">{resources.tags.length}件</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            columns={columns}
            rows={resources.tags}
            rowKey={(tag) => tag.id}
            caption="コンタクトタグ一覧"
            emptyTitle="タグがまだありません"
            emptyDescription="検索や分類に使う最初のタグを作成しましょう。"
            emptyAction={
              <Button variant="outline" onClick={() => setShowCreate(true)}>
                <Tags data-icon="inline-start" />
                タグを作成
              </Button>
            }
          />
        </CardContent>
      </Card>
      <CreateTagForm
        open={showCreate}
        onOpenChange={setShowCreate}
        onSaved={async () => {
          await queryClient.invalidateQueries({
            queryKey: contactResourcesQueryOptions().queryKey,
          });
          setShowCreate(false);
        }}
      />
    </PageLayout>
  );
}

function CreateTagForm({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("タグを作成できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await createContactTag({
        name: getFormString(form, "name"),
        color: getFormString(form, "color"),
      });
      await onSaved();
      toast.success("タグを作成しました");
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="タグを作成"
      description="連絡先を識別するラベルとカラーを設定します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="作成"
    >
      <FormInput label="名前" name="name" placeholder="例：ホットリード" required />
      <FormInput
        label="カラー"
        name="color"
        type="color"
        defaultValue="#64748b"
        description="検索結果やプロフィールでの識別に使用します。"
        required
      />
    </FormDialog>
  );
}
