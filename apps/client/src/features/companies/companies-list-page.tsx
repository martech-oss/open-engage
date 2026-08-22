import { Building2, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";

import { PageLayout } from "@/components/app-ui";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

import { useCompaniesListController } from "./companies-list-controller";
import { CompanyForm } from "./company-forms";

export function CompaniesListPage({ initialQuery }: { initialQuery: string }): ReactNode {
  const controller = useCompaniesListController(initialQuery);
  return (
    <PageLayout
      title="会社"
      action={
        <Button onClick={() => controller.setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          会社を作成
        </Button>
      }
    >
      <div className="max-w-md">
        <InputGroup>
          <InputGroupInput
            value={controller.query}
            onChange={(event) => controller.setQuery(event.target.value)}
            placeholder="会社名またはドメインで検索"
            aria-label="会社を検索"
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <DataTable
            showColumnVisibility
            columns={controller.columns}
            rows={controller.companies}
            rowKey={(company) => company.id}
            caption="会社一覧"
            emptyTitle={
              controller.query ? "条件に一致する会社がありません" : "会社がまだありません"
            }
            emptyDescription={
              controller.query
                ? "検索条件を変更してください。"
                : "最初の会社を作成し、連絡先を会社単位で整理しましょう。"
            }
            emptyAction={
              controller.query ? undefined : (
                <Button variant="outline" onClick={() => controller.setCreateOpen(true)}>
                  <Building2 data-icon="inline-start" />
                  会社を作成
                </Button>
              )
            }
          />
        </CardContent>
      </Card>
      <CompanyForm
        open={controller.createOpen}
        onOpenChange={controller.setCreateOpen}
        title="会社を作成"
        description="会社名とメールドメインを登録します。"
        submitLabel="作成"
        enrichmentEnabled={controller.enrichmentEnabled}
        onSubmit={controller.create}
      />
    </PageLayout>
  );
}
