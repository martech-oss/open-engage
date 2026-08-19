import { useSuspenseQuery } from "@tanstack/react-query";
import { ExternalLink, Link as LinkIcon, MousePointerClick, Pencil } from "lucide-react";
import { type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import {
  ArchiveConfirm,
  CopyButton,
  FormDialog,
  FormInput,
  MetricCard,
  MetricGrid,
} from "@/components/app-ui";
import { type DataTableColumn } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { WebsiteResourceListPage } from "@/features/website/resource-page";
import {
  customRedirectsQueryOptions,
  type CustomRedirectRow,
  siteTrackingQueryOptions,
  useArchiveCustomRedirect,
  useCreateCustomRedirect,
  useUpdateCustomRedirect,
} from "@/features/website/website-api";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource, useResourceEditor } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";
import { formatDateTime } from "@/lib/format";

export function CustomRedirectsPage(): ReactNode {
  const { data: items } = useSuspenseQuery(customRedirectsQueryOptions());
  // The public URL embeds the workspace slug, which the tracking settings
  // already resolve for the install snippet on the neighbouring tab.
  const { data: tracking } = useSuspenseQuery(siteTrackingQueryOptions());
  const { dialogOpen, editing, openCreate, openEdit, close, onOpenChange } =
    useResourceEditor<CustomRedirectRow>();

  const archiveRedirect = useArchiveCustomRedirect();

  async function archive(item: CustomRedirectRow): Promise<void> {
    try {
      await archiveRedirect.mutateAsync({ id: item.id });
      toast.success("リンクをアーカイブしました");
    } catch (error) {
      toast.error(getErrorMessage(error, "アーカイブできませんでした"));
    }
  }

  const columns: DataTableColumn<CustomRedirectRow>[] = [
    {
      key: "name",
      header: "名前",
      cell: (item) => (
        <div className="flex max-w-80 flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="truncate text-xs text-muted-foreground">{item.destinationUrl}</span>
        </div>
      ),
    },
    {
      key: "url",
      header: "計測用URL",
      cell: (item) => {
        const url = publicUrl(tracking.workspaceSlug, item.slug);
        return (
          <div className="flex items-center gap-1">
            <code className="max-w-72 truncate text-xs">{url}</code>
            <CopyButton value={url} label="コピー" />
          </div>
        );
      },
    },
    {
      key: "clicks",
      header: "クリック",
      cell: (item) => item.clickCount.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right",
    },
    {
      key: "updatedAt",
      header: "更新日時",
      cell: (item) => formatDateTime(item.updatedAt),
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
            description={`「${item.name}」の計測用URLは404を返すようになります。公開済みのリンクがないか確認してください。`}
            onConfirm={() => archive(item)}
          />
        </div>
      ),
      headClassName: "text-right",
    },
  ];

  return (
    <WebsiteResourceListPage
      title="計測用リンク"
      createLabel="リンクを作成"
      onCreateClick={openCreate}
      banner={
        <Alert>
          <ExternalLink />
          <AlertTitle>広告・SNS・資料に貼るリンクのクリックを計測します</AlertTitle>
          <AlertDescription>
            計測用URLは遷移先へ302で転送します。サイトトラッキング済みのページから遷移した場合は
            <code className="mx-1 text-xs">?oe_v=</code>
            の訪問者IDで連絡先に紐付き、タイムライン・セグメント・スコアに反映されます。
          </AlertDescription>
        </Alert>
      }
      summary={<RedirectSummary items={items} />}
      listTitle="リンク一覧"
      listDescription="計測用URLをコピーして、広告やSNSの遷移先に設定してください。"
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
      tableCaption="リンク一覧"
      emptyTitle="計測用リンクがありません"
      emptyDescription="遷移先URLとスラッグを指定して、最初のリンクを作成してください。"
      editor={
        <CustomRedirectEditor
          key={editing?.id ?? "new"}
          item={editing}
          open={dialogOpen}
          onOpenChange={onOpenChange}
          onSaved={close}
        />
      }
    />
  );
}

function RedirectSummary({ items }: { items: CustomRedirectRow[] }): ReactNode {
  const clicks = items.reduce((total, item) => total + item.clickCount, 0);
  const cards = [
    {
      label: "リンク",
      value: items.length.toLocaleString(),
      description: "有効な計測用リンク",
      icon: LinkIcon,
    },
    {
      label: "総クリック",
      value: clicks.toLocaleString(),
      description: "匿名クリックを含みます",
      icon: MousePointerClick,
    },
  ];
  return (
    <MetricGrid>
      {cards.map((card) => (
        <MetricCard
          key={card.label}
          label={card.label}
          value={card.value}
          description={
            <div className="flex items-center gap-2 text-sm">
              <card.icon />
              {card.description}
            </div>
          }
        />
      ))}
    </MetricGrid>
  );
}

function CustomRedirectEditor({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: CustomRedirectRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  const createRedirect = useCreateCustomRedirect();
  const updateRedirect = useUpdateCustomRedirect();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      name: getFormString(formData, "name"),
      slug: getFormString(formData, "slug"),
      destinationUrl: getFormString(formData, "destinationUrl"),
    } as const;
    await run(() =>
      saveResource({
        editing: item,
        payload,
        create: (data) => createRedirect.mutateAsync(data),
        update: (id, data) => updateRedirect.mutateAsync({ id, ...data }),
        createdMessage: "計測用リンクを作成しました",
        updatedMessage: "計測用リンクを更新しました",
        onSaved,
      }),
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "計測用リンクを編集" : "計測用リンクを作成"}
      description="遷移先と、URLに使うスラッグを設定します。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "リンクを作成"}
    >
      <FormInput
        label="管理用の名前"
        name="name"
        defaultValue={item?.name}
        placeholder="春キャンペーンのバナー"
        required
      />
      <FormInput
        label="スラッグ"
        name="slug"
        defaultValue={item?.slug}
        description="計測用URLの末尾に使います。英小文字、数字、ハイフンのみ。"
        placeholder="spring-campaign"
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        required
      />
      <FormInput
        label="遷移先URL"
        name="destinationUrl"
        type="url"
        defaultValue={item?.destinationUrl}
        description="スラッグを変更しても、既に配布済みの旧URLは無効になります。"
        placeholder="https://example.com/campaign/spring"
        required
      />
    </FormDialog>
  );
}

function publicUrl(workspaceSlug: string, redirectSlug: string): string {
  return `${window.location.origin}/r/${workspaceSlug}/${redirectSlug}`;
}
