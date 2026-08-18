import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { type FormEvent, type ReactNode } from "react";

import { FormInput, PageLayout } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { dealReportQueryOptions, type DealReportSearch } from "@/features/reports/report-api";
import { reportExport } from "@/features/reports/report-export";
import { DealsReportView } from "@/features/reports/report-views";
import { exportCsv } from "@/lib/csv";
import { getFormString } from "@/lib/form-data";

export function DealReportsPage({ search }: { search: DealReportSearch }): ReactNode {
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(dealReportQueryOptions(search));
  const exportAction = reportExport(data);

  function applyRange(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void navigate({
      to: "/deal-reports",
      search: {
        ...search,
        from: getFormString(form, "from"),
        to: getFormString(form, "to"),
      },
    });
  }

  return (
    <PageLayout
      title="レポート"
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
      <Card>
        <CardContent>
          <form onSubmit={applyRange} key={`${search.from}-${search.to}`}>
            <FieldGroup className="flex-row flex-nowrap items-end gap-3">
              <FieldGroup className="w-auto min-w-44">
                <FormInput
                  label="開始日"
                  name="from"
                  type="date"
                  defaultValue={search.from}
                  required
                />
              </FieldGroup>
              <FieldGroup className="w-auto min-w-44">
                <FormInput label="終了日" name="to" type="date" defaultValue={search.to} required />
              </FieldGroup>
              <Button type="submit" className="shrink-0">
                期間を適用
              </Button>
              <span className="shrink-0 pb-1 text-xs text-muted-foreground">
                最大366日・終了日を含む期間で集計
              </span>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      {data.deals ? (
        <DealsReportView
          report={data.deals}
          onCurrencyChange={(currency) =>
            void navigate({ to: "/deal-reports", search: { ...search, currency } })
          }
        />
      ) : null}
    </PageLayout>
  );
}
