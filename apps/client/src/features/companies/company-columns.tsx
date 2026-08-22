import { Link } from "@tanstack/react-router";
import { UserMinus } from "lucide-react";

import type { DataTableColumn } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { contactSurnameFirstName } from "@/features/contacts/contact-bits";

import type { CompanyContactDto, CompanySummary } from "./company-api";

export function companyListColumns(
  formatDate: (value: string) => string,
): DataTableColumn<CompanySummary>[] {
  return [
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
}

export function companyContactColumns(
  onRemove: (contact: CompanyContactDto) => void,
): DataTableColumn<CompanyContactDto>[] {
  return [
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
        <Button variant="ghost" size="sm" onClick={() => onRemove(contact)}>
          <UserMinus data-icon="inline-start" />
          解除
        </Button>
      ),
      headClassName: "px-4 text-right",
      cellClassName: "px-4 text-right",
    },
  ];
}
