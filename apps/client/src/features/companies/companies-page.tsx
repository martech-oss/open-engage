import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Sparkles,
  UserMinus,
  UsersRound,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { PageLayout } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  companiesQueryOptions,
  companyEnrichmentCapabilityQueryOptions,
  companyContactOptionsQueryOptions,
  companyQueryOptions,
  useAssignCompanyContact,
  useCreateCompany,
  useRemoveCompanyContact,
  useUpdateCompany,
  type CompanyContactDto,
  type CompanySummary,
} from "@/features/companies/company-api";
import { contactSurnameFirstName } from "@/features/contacts/contact-bits";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useWorkspaceFormatters } from "@/lib/workspace-time";

import { CompanyEnrichmentSheet } from "./company-enrichment-sheet";
import { AddCompanyContactForm, CompanyForm } from "./company-forms";

export function CompaniesPage({ initialQuery }: { initialQuery: string }): ReactNode {
  const { formatDate } = useWorkspaceFormatters();
  const navigate = useNavigate();
  const { data: companies } = useSuspenseQuery(companiesQueryOptions(initialQuery));
  const { data: enrichmentCapability } = useSuspenseQuery(
    companyEnrichmentCapabilityQueryOptions(),
  );
  const [query, setQuery] = useState(initialQuery);
  const [showCreate, setShowCreate] = useState(false);
  const createCompany = useCreateCompany();

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useDebouncedSearch({
    value: query,
    onCommit: (value) => {
      if (value === initialQuery) return;
      void navigate({ to: "/companies", search: { q: value }, replace: true });
    },
  });

  const columns: DataTableColumn<CompanySummary>[] = [
    {
      key: "name",
      header: "会社名",
      sortValue: (company) => company.name.toLocaleLowerCase(),
      cell: (company) => (
        <Button
          variant="link"
          className="h-auto p-0"
          nativeButton={false}
          render={<Link to="/companies/$id" params={{ id: company.id }} />}
        >
          {company.name}
        </Button>
      ),
      headClassName: "px-4",
      cellClassName: "px-4 font-medium",
    },
    {
      key: "domain",
      header: "ドメイン",
      sortValue: (company) => (company.domain ?? "").toLocaleLowerCase(),
      cell: (company) => company.domain ?? "未設定",
      cellClassName: "text-muted-foreground",
    },
    {
      key: "contactCount",
      header: "連絡先",
      sortValue: (company) => Number(company.contactCount),
      cell: (company) => (
        <Badge variant="secondary">{Number(company.contactCount).toLocaleString()}人</Badge>
      ),
    },
    {
      key: "updatedAt",
      header: "更新日",
      sortValue: (company) => company.updatedAt,
      cell: (company) => formatDate(company.updatedAt),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right text-muted-foreground",
    },
  ];

  return (
    <PageLayout
      title="会社"
      action={
        <Button onClick={() => setShowCreate(true)}>
          <Plus data-icon="inline-start" />
          会社を作成
        </Button>
      }
    >
      <div className="max-w-md">
        <InputGroup>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
            columns={columns}
            rows={companies}
            rowKey={(company) => company.id}
            caption="会社一覧"
            emptyTitle={query ? "条件に一致する会社がありません" : "会社がまだありません"}
            emptyDescription={
              query
                ? "検索条件を変更してください。"
                : "最初の会社を作成し、連絡先を会社単位で整理しましょう。"
            }
            emptyAction={
              query ? undefined : (
                <Button variant="outline" onClick={() => setShowCreate(true)}>
                  <Building2 data-icon="inline-start" />
                  会社を作成
                </Button>
              )
            }
          />
        </CardContent>
      </Card>
      <CompanyForm
        open={showCreate}
        onOpenChange={setShowCreate}
        title="会社を作成"
        description="会社名とメールドメインを登録します。"
        submitLabel="作成"
        enrichmentEnabled={enrichmentCapability.enabled}
        onSubmit={async (values) => {
          const company = await createCompany.mutateAsync(values);
          toast.success("会社を作成しました");
          setShowCreate(false);
          await navigate({
            to: "/companies/$id",
            params: { id: company.id },
          });
        }}
      />
    </PageLayout>
  );
}

export function CompanyDetailPage({ companyId }: { companyId: string }): ReactNode {
  const { data: company } = useSuspenseQuery(companyQueryOptions(companyId));
  const { data: enrichmentCapability } = useSuspenseQuery(
    companyEnrichmentCapabilityQueryOptions(),
  );
  const { data: contactOptions } = useSuspenseQuery(companyContactOptionsQueryOptions());
  const [showEdit, setShowEdit] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showEnrichment, setShowEnrichment] = useState(false);
  const updateCompany = useUpdateCompany();
  const removeContact = useRemoveCompanyContact();
  const assignContact = useAssignCompanyContact();

  const assignedIds = new Set(company.contacts.map((contact) => contact.id));

  const columns: DataTableColumn<CompanyContactDto>[] = [
    {
      key: "contact",
      header: "連絡先",
      sortValue: (contact) =>
        (contactSurnameFirstName(contact) || contact.email || "").toLocaleLowerCase(),
      cell: (contact) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {contactSurnameFirstName(contact) || contact.email || "名前未設定"}
            {contact.isPrimary ? (
              <Badge variant="outline" className="ml-2">
                主担当
              </Badge>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">{contact.email ?? "メール未設定"}</span>
        </div>
      ),
      headClassName: "px-4",
      cellClassName: "px-4",
    },
    {
      key: "title",
      header: "役職",
      sortValue: (contact) => (contact.title ?? "").toLocaleLowerCase(),
      cell: (contact) => contact.title ?? "未設定",
      cellClassName: "text-muted-foreground",
    },
    {
      key: "stage",
      header: "ステージ",
      sortValue: (contact) => contact.stage,
      cell: (contact) => <Badge variant="secondary">{contact.stage}</Badge>,
    },
    {
      key: "score",
      header: "スコア",
      sortValue: (contact) => contact.score,
      cell: (contact) => contact.score,
      cellClassName: "tabular-nums",
    },
    {
      key: "actions",
      header: "操作",
      enableHiding: false,
      cell: (contact) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void removeContact.mutateAsync({ id: company.id, contactId: contact.id }).then(() => {
              toast.success("会社との関連を解除しました");
            });
          }}
        >
          <UserMinus data-icon="inline-start" />
          解除
        </Button>
      ),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right",
    },
  ];

  return (
    <PageLayout
      title={company.name}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/companies" />}>
            <ArrowLeft data-icon="inline-start" />
            一覧
          </Button>
          <Button variant="outline" onClick={() => setShowEdit(true)}>
            <Pencil data-icon="inline-start" />
            編集
          </Button>
          {enrichmentCapability.enabled ? (
            <Button variant="outline" onClick={() => setShowEnrichment(true)}>
              <Sparkles data-icon="inline-start" />
              会社情報を取得
            </Button>
          ) : null}
          <Button onClick={() => setShowAddContact(true)}>
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
            columns={columns}
            rows={company.contacts}
            rowKey={(contact) => contact.id}
            caption={`${company.name}に所属する連絡先`}
            emptyTitle="所属する連絡先がありません"
            emptyDescription="既存の連絡先をこの会社へ関連付けてください。"
            emptyAction={
              <Button variant="outline" onClick={() => setShowAddContact(true)}>
                <UsersRound data-icon="inline-start" />
                連絡先を追加
              </Button>
            }
          />
        </CardContent>
      </Card>
      <CompanyForm
        open={showEdit}
        onOpenChange={setShowEdit}
        title="会社を編集"
        description="会社名とドメインを更新します。"
        initialName={company.name}
        initialDomain={company.domain ?? ""}
        submitLabel="変更を保存"
        onSubmit={async (values) => {
          await updateCompany.mutateAsync({
            id: company.id,
            name: values.name,
            domain: values.domain || null,
          });
          toast.success("会社を更新しました");
          setShowEdit(false);
        }}
      />
      <AddCompanyContactForm
        open={showAddContact}
        onOpenChange={setShowAddContact}
        title="連絡先を追加"
        description={`${company.name}へ既存の連絡先を関連付けます。`}
        contacts={contactOptions.items.filter((contact) => !assignedIds.has(contact.id))}
        onSubmit={async (values) => {
          await assignContact.mutateAsync({ id: company.id, ...values });
          toast.success("連絡先を会社へ追加しました");
          setShowAddContact(false);
        }}
      />
      <CompanyEnrichmentSheet
        open={showEnrichment}
        onOpenChange={setShowEnrichment}
        source={{ source: "company", companyId: company.id }}
        currentName={company.name}
        currentDomain={company.domain ?? ""}
        onApply={async (values) => {
          await updateCompany.mutateAsync({ id: company.id, ...values });
          toast.success("取得した会社情報を反映しました");
        }}
      />
    </PageLayout>
  );
}
