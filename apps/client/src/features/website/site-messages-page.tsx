import { useSuspenseQuery } from "@tanstack/react-query";
import { Eye, Link as LinkIcon, MessageSquareText, MousePointerClick, Pencil } from "lucide-react";
import { type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import {
  ArchiveConfirm,
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  FormTextarea,
  MetricCard,
  MetricGrid,
} from "@/components/app-ui";
import { type DataTableColumn } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { WebsiteResourceListPage } from "@/features/website/resource-page";
import {
  siteMessagesQueryOptions,
  type SiteMessageRow,
  useArchiveSiteMessage,
  useCreateSiteMessage,
  useUpdateSiteMessage,
} from "@/features/website/website-api";
import { PublishStatusBadge } from "@/features/website/website-shared";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { saveResource, useResourceEditor } from "@/hooks/use-resource-editor";
import { getFormString } from "@/lib/form-data";
import { formatDateTime, toDateTimeLocal } from "@/lib/format";

export function SiteMessagesPage(): ReactNode {
  const { data: items } = useSuspenseQuery(siteMessagesQueryOptions());
  const { dialogOpen, editing, openCreate, openEdit, close, onOpenChange } =
    useResourceEditor<SiteMessageRow>();

  const archiveMessage = useArchiveSiteMessage();

  async function archive(item: SiteMessageRow): Promise<void> {
    try {
      await archiveMessage.mutateAsync({ id: item.id });
      toast.success("サイトメッセージをアーカイブしました");
    } catch (error) {
      toast.error(getErrorMessage(error, "アーカイブできませんでした"));
    }
  }

  const columns: DataTableColumn<SiteMessageRow>[] = [
    {
      key: "name",
      header: "名前",
      cell: (item) => (
        <div className="flex max-w-80 flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="truncate text-xs text-muted-foreground">{item.headline}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "状態",
      cell: (item) => <PublishStatusBadge status={item.status} />,
    },
    {
      key: "pagePattern",
      header: "ページ条件",
      cell: (item) => <code className="text-xs">{item.pagePattern}</code>,
    },
    {
      key: "impressions",
      header: "表示",
      cell: (item) => item.impressionCount.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right",
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
            description={`「${item.name}」は公開を終了し、通常の一覧から非表示になります。`}
            onConfirm={() => archive(item)}
          />
        </div>
      ),
      headClassName: "text-right",
    },
  ];

  return (
    <WebsiteResourceListPage
      title="サイトメッセージ"
      createLabel="メッセージを作成"
      onCreateClick={openCreate}
      banner={
        <Alert>
          <LinkIcon />
          <AlertTitle>サイトトラッキングと連動します</AlertTitle>
          <AlertDescription>
            許可ドメインで識別された連絡先にのみ表示します。匿名の訪問者には表示しません。
          </AlertDescription>
        </Alert>
      }
      summary={<MessageSummary items={items} />}
      listTitle="メッセージ一覧"
      listDescription="公開状態、ページ条件、表示・クリック実績を確認できます。"
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
      tableCaption="メッセージ一覧"
      emptyTitle="サイトメッセージがありません"
      emptyDescription="ページ条件と表示期間を指定して、最初のメッセージを作成してください。"
      editor={
        <SiteMessageEditor
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

function MessageSummary({ items }: { items: SiteMessageRow[] }): ReactNode {
  const impressions = items.reduce((total, item) => total + item.impressionCount, 0);
  const clicks = items.reduce((total, item) => total + item.clickCount, 0);
  const clickRate = impressions > 0 ? (clicks / impressions) * 100 : 0;
  return (
    <MetricGrid>
      {[
        {
          label: "メッセージ",
          value: items.length.toLocaleString(),
          description: "現在のメッセージ数",
          icon: MessageSquareText,
        },
        {
          label: "公開中",
          value: items.filter((item) => item.status === "published").length.toLocaleString(),
          description: "配信条件の評価対象",
          icon: LinkIcon,
        },
        {
          label: "表示",
          value: impressions.toLocaleString(),
          description: "識別済み連絡先への表示",
          icon: Eye,
        },
        {
          label: "クリック率",
          value: `${clickRate.toFixed(1)}%`,
          description: `${clicks.toLocaleString()}クリック`,
          icon: MousePointerClick,
        },
      ].map((item) => (
        <MetricCard
          key={item.label}
          label={item.label}
          value={item.value}
          description={
            <div className="flex items-center gap-2 text-sm">
              <item.icon />
              {item.description}
            </div>
          }
        />
      ))}
    </MetricGrid>
  );
}

function SiteMessageEditor({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: SiteMessageRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}): ReactNode {
  const { busy, error, run, setError } = useFormSubmission("保存できませんでした");

  const createMessage = useCreateSiteMessage();
  const updateMessage = useUpdateSiteMessage();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const ctaUrl = getFormString(formData, "ctaUrl").trim();
    const startsAt = dateTimeValue(formData.get("startsAt"));
    const endsAt = dateTimeValue(formData.get("endsAt"));
    if (startsAt && endsAt && startsAt >= endsAt) {
      setError("終了日時は開始日時より後にしてください");
      return;
    }
    const payload = {
      name: getFormString(formData, "name"),
      status: getFormString(formData, "status") === "published" ? "published" : "draft",
      headline: getFormString(formData, "headline"),
      body: getFormString(formData, "body"),
      ctaLabel: getFormString(formData, "ctaLabel"),
      ctaUrl: ctaUrl || null,
      pagePattern: getFormString(formData, "pagePattern"),
      startsAt,
      endsAt,
    } as const;
    await run(() =>
      saveResource({
        editing: item,
        payload,
        create: (data) => createMessage.mutateAsync(data),
        update: (id, data) => updateMessage.mutateAsync({ id, ...data }),
        createdMessage: "サイトメッセージを作成しました",
        updatedMessage: "サイトメッセージを更新しました",
        onSaved,
      }),
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "サイトメッセージを編集" : "サイトメッセージを作成"}
      description="サイト右下に表示する内容と対象ページを設定します。"
      className="sm:max-w-2xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "変更を保存" : "メッセージを作成"}
    >
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="管理用の名前"
          name="name"
          defaultValue={item?.name}
          placeholder="料金ページの案内"
          required
        />
        <FormNativeSelect label="公開状態" name="status" defaultValue={item?.status ?? "draft"}>
          <FormSelectOption value="draft">下書き</FormSelectOption>
          <FormSelectOption value="published">公開</FormSelectOption>
        </FormNativeSelect>
      </FieldGroup>
      <FormInput
        label="見出し"
        name="headline"
        defaultValue={item?.headline}
        placeholder="ご不明な点はありませんか？"
        required
      />
      <FormTextarea label="本文" name="body" defaultValue={item?.body} rows={3} />
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="CTAラベル"
          name="ctaLabel"
          defaultValue={item?.ctaLabel ?? ""}
          placeholder="相談する"
        />
        <FormInput
          label="CTAリンク"
          name="ctaUrl"
          type="url"
          defaultValue={item?.ctaUrl ?? ""}
          placeholder="https://example.com/contact"
        />
      </FieldGroup>
      <FormInput
        label="対象ページ"
        name="pagePattern"
        defaultValue={item?.pagePattern ?? "*"}
        description="* はすべてのページ、/pricing* は料金ページ配下を表します。"
        placeholder="/pricing*"
        required
      />
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="表示開始"
          name="startsAt"
          type="datetime-local"
          defaultValue={toDateTimeLocal(item?.startsAt)}
        />
        <FormInput
          label="表示終了"
          name="endsAt"
          type="datetime-local"
          defaultValue={toDateTimeLocal(item?.endsAt)}
        />
      </FieldGroup>
    </FormDialog>
  );
}

function dateTimeValue(value: FormDataEntryValue | null): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? new Date(raw).toISOString() : null;
}
