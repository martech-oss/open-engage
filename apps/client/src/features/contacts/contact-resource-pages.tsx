import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Plus, Tags } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { FormDialog, FormInput, PageLayout } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  contactResourcesQueryOptions,
  createContactTag,
  updateContactTag,
  type ContactResources,
} from "@/features/contacts/contact-resource-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";

type TagRow = ContactResources["tags"][number];

export function ContactTagsPage(): ReactNode {
  const { data: resources } = useSuspenseQuery(contactResourcesQueryOptions());
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TagRow | null>(null);

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(tag: TagRow): void {
    setEditing(tag);
    setFormOpen(true);
  }

  const columns: DataTableColumn<TagRow>[] = [
    {
      key: "tag",
      header: "タグ",
      sortValue: (tag) => tag.name.toLocaleLowerCase(),
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
      sortValue: (tag) => tag.color.toLocaleLowerCase(),
      cell: (tag) => (
        <span className="font-mono text-xs text-muted-foreground">{tag.color.toUpperCase()}</span>
      ),
    },
    {
      key: "slug",
      header: "スラッグ",
      sortValue: (tag) => tag.slug.toLocaleLowerCase(),
      cell: (tag) => <span className="font-mono text-xs text-muted-foreground">{tag.slug}</span>,
    },
    {
      key: "contactCount",
      header: "連絡先",
      sortValue: (tag) => Number(tag.contactCount),
      cell: (tag) => <Badge variant="secondary">{Number(tag.contactCount).toLocaleString()}</Badge>,
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right",
    },
  ];

  return (
    <PageLayout
      title="タグ"
      action={
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          タグを作成
        </Button>
      }
    >
      <Card className="py-0">
        <CardContent className="px-0">
          <DataTable
            showColumnVisibility
            columns={columns}
            rows={resources.tags}
            rowKey={(tag) => tag.id}
            caption="コンタクトタグ一覧"
            emptyTitle="タグがまだありません"
            emptyDescription="検索や分類に使う最初のタグを作成しましょう。"
            emptyAction={
              <Button variant="outline" onClick={openCreate}>
                <Tags data-icon="inline-start" />
                タグを作成
              </Button>
            }
            onRowClick={openEdit}
          />
        </CardContent>
      </Card>
      <TagForm
        key={`${editing?.id ?? "new"}-${formOpen}`}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        onSaved={async () => {
          await queryClient.invalidateQueries({
            queryKey: contactResourcesQueryOptions().queryKey,
          });
          setFormOpen(false);
          setEditing(null);
        }}
      />
    </PageLayout>
  );
}

function TagForm({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: TagRow | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission(
    initial ? "タグを更新できませんでした" : "タグを作成できませんでした",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = getFormString(form, "name");
    const color = getFormString(form, "color");
    await run(async () => {
      if (initial) {
        await updateContactTag({ id: initial.id, name, color });
        await onSaved();
        toast.success("タグを更新しました");
        return;
      }
      await createContactTag({ name, color });
      await onSaved();
      toast.success("タグを作成しました");
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "タグを編集" : "タグを作成"}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={initial ? "更新" : "作成"}
    >
      <FormInput
        label="名前"
        name="name"
        placeholder="例：ホットリード"
        defaultValue={initial?.name}
        required
      />
      <FormInput
        label="カラー"
        name="color"
        type="color"
        defaultValue={initial?.color ?? "#64748b"}
        description="検索結果やプロフィールでの識別に使用します。"
        required
      />
    </FormDialog>
  );
}
