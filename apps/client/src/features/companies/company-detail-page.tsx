import { Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Pencil, Plus, Sparkles, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

import { PageLayout } from "@/components/app-ui";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { useCompanyDetailController } from "./company-detail-controller";
import { CompanyEnrichmentSheet } from "./company-enrichment-sheet";
import { AddCompanyContactForm, CompanyForm } from "./company-forms";

export function CompanyDetailPage({ companyId }: { companyId: string }): ReactNode {
  const controller = useCompanyDetailController(companyId);
  const company = controller.company;
  return (
    <PageLayout
      title={company.name}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/companies" />}>
            <ArrowLeft data-icon="inline-start" />
            一覧
          </Button>
          <Button variant="outline" onClick={() => controller.setEditOpen(true)}>
            <Pencil data-icon="inline-start" />
            編集
          </Button>
          {controller.enrichmentEnabled ? (
            <Button variant="outline" onClick={() => controller.setEnrichmentOpen(true)}>
              <Sparkles data-icon="inline-start" />
              会社情報を取得
            </Button>
          ) : null}
          <Button onClick={() => controller.setAddContactOpen(true)}>
            <Plus data-icon="inline-start" />
            連絡先を追加
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>会社ドメイン</CardDescription>
            <CardTitle>{company.domain ?? "未設定"}</CardTitle>
            {company.domain ? (
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon"
                  nativeButton={false}
                  render={
                    <a
                      href={`https://${company.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${company.domain}を開く`}
                    />
                  }
                >
                  <ExternalLink />
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>所属する連絡先</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {company.contacts.length.toLocaleString()}人
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <DataTable
            showColumnVisibility
            columns={controller.columns}
            rows={company.contacts}
            rowKey={(contact) => contact.id}
            caption={`${company.name}に所属する連絡先`}
            emptyTitle="所属する連絡先がありません"
            emptyDescription="既存の連絡先をこの会社へ関連付けてください。"
            emptyAction={
              <Button variant="outline" onClick={() => controller.setAddContactOpen(true)}>
                <UsersRound data-icon="inline-start" />
                連絡先を追加
              </Button>
            }
          />
        </CardContent>
      </Card>
      <CompanyForm
        open={controller.editOpen}
        onOpenChange={controller.setEditOpen}
        title="会社を編集"
        description="会社名とドメインを更新します。"
        initialName={company.name}
        initialDomain={company.domain ?? ""}
        submitLabel="変更を保存"
        onSubmit={controller.update}
      />
      <AddCompanyContactForm
        open={controller.addContactOpen}
        onOpenChange={controller.setAddContactOpen}
        title="連絡先を追加"
        description={`${company.name}へ既存の連絡先を関連付けます。`}
        contacts={controller.availableContacts}
        onSubmit={controller.assign}
      />
      <CompanyEnrichmentSheet
        open={controller.enrichmentOpen}
        onOpenChange={controller.setEnrichmentOpen}
        source={{ source: "company", companyId: company.id }}
        currentName={company.name}
        currentDomain={company.domain ?? ""}
        onApply={controller.applyEnrichment}
      />
    </PageLayout>
  );
}
