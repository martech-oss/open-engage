import { useSuspenseQuery } from "@tanstack/react-query";
import { Activity, ChartNoAxesCombined, ContactRound, Eye, Info } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
  CopyButton,
  ErrorAlert,
  FormTextarea,
  LoadingButton,
  MetricCard,
  MetricGrid,
  PageLayout,
} from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  siteTrackingQueryOptions,
  type SiteTrackingData,
  type TrackingTopPage,
  useUpdateSiteTracking,
} from "@/features/website/website-api";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

export function SiteTrackingPage(): ReactNode {
  const { data } = useSuspenseQuery(siteTrackingQueryOptions());
  const [enabled, setEnabled] = useState(data.enabled);
  const { busy, error, run } = useFormSubmission("設定を保存できませんでした");
  const trackingCode = buildTrackingCode(data.workspaceSlug);

  const updateTracking = useUpdateSiteTracking();

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const allowedDomains = getFormString(formData, "allowedDomains")
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    await run(async () => {
      await updateTracking.mutateAsync({ enabled, allowedDomains });
      toast.success("サイトトラッキング設定を保存しました");
    });
  }

  return (
    <PageLayout title="サイトトラッキング">
      <TrackingSummary data={data} />
      <Tabs defaultValue="setup">
        <TabsList>
          <TabsTrigger value="setup">設定と設置コード</TabsTrigger>
          <TabsTrigger value="activity">訪問アクティビティ</TabsTrigger>
        </TabsList>
        <TabsContent value="setup" className="flex flex-col gap-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Card>
              <CardHeader>
                <CardTitle>トラッキング設定</CardTitle>
                <CardDescription>有効化するサイトをホワイトリストで制限します。</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={(event) => void save(event)}>
                  <FieldGroup>
                    <Field orientation="horizontal">
                      <Switch
                        id="tracking-enabled"
                        checked={enabled}
                        onCheckedChange={setEnabled}
                      />
                      <FieldContent>
                        <FieldLabel htmlFor="tracking-enabled">
                          <FieldTitle>サイトトラッキング</FieldTitle>
                          <FieldDescription>
                            無効にすると公開エンドポイントは訪問を保存しません。
                          </FieldDescription>
                        </FieldLabel>
                      </FieldContent>
                    </Field>
                    <FormTextarea
                      label="許可ドメイン"
                      name="allowedDomains"
                      defaultValue={data.allowedDomains.join("\n")}
                      description="http:// を除き、1行に1ドメインを入力してください。サブドメインも許可されます。"
                      placeholder={"example.com\ncampaign.example.com"}
                      rows={5}
                    />
                    {error ? <ErrorAlert>{error}</ErrorAlert> : null}
                    <LoadingButton busy={busy} type="submit">
                      設定を保存
                    </LoadingButton>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>設置コード</CardTitle>
                <CardDescription>
                  同意取得後、追跡するすべてのページで読み込んでください。
                </CardDescription>
                <CardAction>
                  <CopyButton value={trackingCode} label="コピー" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
                  <code>{trackingCode}</code>
                </pre>
              </CardContent>
            </Card>
          </div>
          <Alert>
            <Info />
            <AlertTitle>訪問者の同意が必須です</AlertTitle>
            <AlertDescription>
              サンプルコードの consent: true
              は、Cookieバナー等で同意を得た後にだけ設定してください。 既知の連絡先は
              openengage.identify(email) で識別でき、サイトメッセージの対象になります。
            </AlertDescription>
          </Alert>
        </TabsContent>
        <TabsContent value="activity" className="flex flex-col gap-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <TopPages items={data.topPages} />
            <RecentEvents items={data.recentEvents} />
          </div>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

function TrackingSummary({ data }: { data: SiteTrackingData }): ReactNode {
  const cards = [
    {
      label: "30日間のページビュー",
      value: data.summary.pageViews,
      description: "許可サイトで記録",
      icon: Eye,
    },
    {
      label: "ユニーク訪問者",
      value: data.summary.uniqueVisitors,
      description: "Visitor IDベース",
      icon: ChartNoAxesCombined,
    },
    {
      label: "識別済み連絡先",
      value: data.summary.identifiedContacts,
      description: "メールと関連付け済み",
      icon: ContactRound,
    },
    {
      label: "ステータス",
      value: data.enabled ? "ON" : "OFF",
      description: `${data.allowedDomains.length}ドメインを許可`,
      icon: Activity,
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

function TopPages({ items }: { items: SiteTrackingData["topPages"] }): ReactNode {
  const columns: DataTableColumn<TrackingTopPage>[] = [
    {
      key: "url",
      header: "URL",
      cell: (item) => <span className="block max-w-96 truncate">{item.url}</span>,
    },
    {
      key: "views",
      header: "表示",
      cell: (item) => item.views.toLocaleString(),
      headClassName: "text-right",
      cellClassName: "text-right",
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>上位ページ</CardTitle>
        <CardDescription>過去30日間のページビュー順です。</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(item) => item.url}
          caption="上位ページ"
          emptyTitle="まだページビューがありません"
        />
      </CardContent>
    </Card>
  );
}

function RecentEvents({ items }: { items: SiteTrackingData["recentEvents"] }): ReactNode {
  const { formatDateTime } = useWorkspaceFormatters();
  const columns: DataTableColumn<SiteTrackingData["recentEvents"][number]>[] = [
    {
      key: "resourceId",
      header: "訪問ページ",
      cell: (item) => <span className="block max-w-64 truncate">{item.resourceId}</span>,
    },
    {
      key: "contactId",
      header: "訪問者",
      cell: (item) => (
        <Badge variant={item.contactId ? "default" : "secondary"}>
          {item.contactId ? "識別済み" : "匿名"}
        </Badge>
      ),
    },
    {
      key: "occurredAt",
      header: "日時",
      cell: (item) => formatDateTime(item.occurredAt),
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>最近の訪問</CardTitle>
        <CardDescription>直近20件のページビューです。</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(item) => `${item.visitorId}-${item.occurredAt}-${items.indexOf(item)}`}
          caption="最近の訪問"
          emptyTitle="まだ訪問データがありません"
        />
      </CardContent>
    </Card>
  );
}

function buildTrackingCode(workspaceSlug: string): string {
  const scriptUrl = `${window.location.origin}/api/public/site-tracking/${workspaceSlug}/script.js`;
  return `<script>
  window.openengageSettings = {
    consent: true
  };
</script>
<script async src="${scriptUrl}"></script>`;
}
