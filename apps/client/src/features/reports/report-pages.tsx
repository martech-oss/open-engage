import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BriefcaseBusiness,
  ChartNoAxesCombined,
  Download,
  GitBranch,
  Globe2,
  Mail,
  UsersRound,
} from "lucide-react";
import { type FormEvent, type ReactNode } from "react";

import { FormInput, MetricCard, MetricGrid, PageLayout } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import {
  type AutomationsReport,
  type ContactsReport,
  type DealsReport,
  type EmailsReport,
  reportWorkspaceQueryOptions,
  type ReportSearch,
  type ReportView,
  type SiteReport,
} from "@/features/reports/report-api";
import { exportCsv } from "@/lib/csv";
import { getFormString } from "@/lib/form-data";
import { formatMoney, formatPercent } from "@/lib/format";

import { reportExport } from "./report-export";
import {
  AutomationsReportView,
  ContactsReportView,
  DealsReportView,
  EmailsReportView,
  SiteReportView,
} from "./report-views";
import { AttentionItem, ProgressRow } from "./report-widgets";

const reportNavigation: Array<{
  view: ReportView;
  label: string;
  icon: typeof ChartNoAxesCombined;
}> = [
  { view: "overview", label: "概要", icon: ChartNoAxesCombined },
  { view: "contacts", label: "連絡先", icon: UsersRound },
  { view: "automations", label: "オートメーション", icon: GitBranch },
  { view: "emails", label: "メール", icon: Mail },
  { view: "deals", label: "商談", icon: BriefcaseBusiness },
  { view: "site", label: "サイト", icon: Globe2 },
];

export function ReportsPage({ search }: { search: ReportSearch }): ReactNode {
  const { data } = useSuspenseQuery(reportWorkspaceQueryOptions(search));
  const exportAction = reportExport(data);
  return (
    <PageLayout
      title="Reporting"
      action={
        exportAction ? (
          <Button
            variant="outline"
            onClick={() => exportCsv(exportAction.filename, exportAction.rows)}
          >
            <Download data-icon="inline-start" />
            CSVをエクスポート
          </Button>
        ) : undefined
      }
    >
      <ReportControls search={search} />
      {data.view === "overview" &&
      data.contacts &&
      data.automations &&
      data.emails &&
      data.deals &&
      data.site ? (
        <ReportsOverview
          search={search}
          contacts={data.contacts}
          automations={data.automations}
          emails={data.emails}
          deals={data.deals}
          site={data.site}
        />
      ) : null}
      {data.view === "contacts" && data.contacts ? (
        <ContactsReportView report={data.contacts} />
      ) : null}
      {data.view === "automations" && data.automations ? (
        <AutomationsReportView report={data.automations} />
      ) : null}
      {data.view === "emails" && data.emails ? <EmailsReportView report={data.emails} /> : null}
      {data.view === "deals" && data.deals ? (
        <DealsReportView report={data.deals} search={search} />
      ) : null}
      {data.view === "site" && data.site ? <SiteReportView report={data.site} /> : null}
    </PageLayout>
  );
}

function ReportControls({ search }: { search: ReportSearch }): ReactNode {
  const navigate = useNavigate();

  function applyRange(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void navigate({
      to: "/reports",
      search: {
        ...search,
        from: getFormString(form, "from"),
        to: getFormString(form, "to"),
      },
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="レポートカテゴリ">
          {reportNavigation.map((item) => (
            <Button
              key={item.view}
              variant={search.view === item.view ? "default" : "ghost"}
              nativeButton={false}
              render={
                <Link
                  to="/reports"
                  search={{
                    ...search,
                    view: item.view,
                  }}
                />
              }
            >
              <item.icon data-icon="inline-start" />
              {item.label}
            </Button>
          ))}
        </nav>
        <form onSubmit={applyRange} key={`${search.from}-${search.to}`}>
          <FieldGroup className="flex-row flex-wrap items-end gap-3 border-t pt-4">
            <FieldGroup className="min-w-44">
              <FormInput
                label="開始日"
                name="from"
                type="date"
                defaultValue={search.from}
                required
              />
            </FieldGroup>
            <FieldGroup className="min-w-44">
              <FormInput label="終了日" name="to" type="date" defaultValue={search.to} required />
            </FieldGroup>
            <Button type="submit">期間を適用</Button>
            <span className="pb-1 text-xs text-muted-foreground">
              最大366日・終了日を含む期間で集計
            </span>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function ReportsOverview({
  search,
  contacts,
  automations,
  emails,
  deals,
  site,
}: {
  search: ReportSearch;
  contacts: ContactsReport;
  automations: AutomationsReport;
  emails: EmailsReport;
  deals: DealsReport;
  site: SiteReport;
}): ReactNode {
  const cards = [
    {
      view: "contacts" as const,
      title: "連絡先",
      icon: UsersRound,
      value: `${contacts.summary.newContacts.toLocaleString()}人`,
      label: "期間内の新規連絡先",
      detail: `現在のアクティブ ${contacts.summary.activeContacts.toLocaleString()}人`,
    },
    {
      view: "automations" as const,
      title: "オートメーション",
      icon: GitBranch,
      value: `${automations.summary.entries.toLocaleString()}件`,
      label: "フローへの参加",
      detail: `完了率 ${formatPercent(automations.summary.completionRate)}`,
    },
    {
      view: "emails" as const,
      title: "メール",
      icon: Mail,
      value: `${emails.summary.sends.toLocaleString()}通`,
      label: "メール送信",
      detail: `開封率 ${formatPercent(emails.summary.openRate)}`,
    },
    {
      view: "deals" as const,
      title: "商談",
      icon: BriefcaseBusiness,
      value: formatMoney(deals.summary.wonValue, deals.currency),
      label: "獲得金額",
      detail: `勝率 ${formatPercent(deals.summary.winRate)}`,
    },
    {
      view: "site" as const,
      title: "サイト",
      icon: Globe2,
      value: `${site.summary.pageViews.toLocaleString()}回`,
      label: "ページビュー",
      detail: `フォーム送信 ${site.summary.submissions.toLocaleString()}件`,
    },
  ];
  return (
    <>
      <section>
        <h2 className="mb-3 font-heading text-lg font-medium">パフォーマンス概要</h2>
        <MetricGrid className="md:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <MetricCard
              key={card.view}
              label={card.title}
              value={card.value}
              icon={<card.icon />}
              description={
                <div>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="mt-1 text-sm">{card.detail}</p>
                </div>
              }
            >
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to="/reports" search={{ ...search, view: card.view }} />}
              >
                詳細を見る
              </Button>
            </MetricCard>
          ))}
        </MetricGrid>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>ファネルの状態</CardTitle>
            <CardDescription>顧客獲得から商談獲得までの主要指標</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ProgressRow
              label="新規連絡先"
              value={contacts.summary.newContacts}
              maximum={Math.max(contacts.summary.newContacts, automations.summary.entries, 1)}
            />
            <ProgressRow
              label="オートメーション参加"
              value={automations.summary.entries}
              maximum={Math.max(contacts.summary.newContacts, automations.summary.entries, 1)}
            />
            <ProgressRow
              label="獲得商談"
              value={deals.summary.won}
              maximum={Math.max(contacts.summary.newContacts, automations.summary.entries, 1)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>注意が必要な指標</CardTitle>
            <CardDescription>運用上の確認候補</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <AttentionItem label="メールバウンス" value={emails.summary.bounces} />
            <AttentionItem label="配信停止" value={emails.summary.unsubscribes} />
            <AttentionItem label="期限超過タスク" value={deals.summary.overdueTasks} />
            <AttentionItem label="アーカイブ連絡先" value={contacts.summary.archivedContacts} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
