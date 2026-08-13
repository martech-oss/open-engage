import { Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { ArchiveConfirm, CopyButton } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { type MessageVariableRow, useArchiveEmailVariable } from "@/features/emails/email-api";
import { getErrorMessage } from "@/hooks/use-form-submission";
import { formatDateTime } from "@/lib/format";

export function VariableReference({ variables }: { variables: MessageVariableRow[] }): ReactNode {
  const builtInVariables = [
    ["{{ contact.first_name }}", "連絡先の名"],
    ["{{ contact.last_name }}", "連絡先の姓"],
    ["{{ contact.email }}", "メールアドレス"],
    ["{{ workspace.name }}", "Workspace名"],
    ["{{ contact.custom_key }}", "カスタム属性（custom_keyを置換）"],
    ...variables.map(
      (variable) =>
        [messageVariableToken(variable.key), `メッセージ変数: ${variable.name}`] as const,
    ),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>テンプレート変数</CardTitle>
      </CardHeader>
      <CardContent>
        <ItemGroup className="grid gap-3 sm:grid-cols-2">
          {builtInVariables.map(([token, label]) => (
            <Item key={token} variant="outline">
              <ItemContent className="min-w-0">
                <ItemTitle>
                  <code>{token}</code>
                </ItemTitle>
                <ItemDescription>{label}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <CopyButton value={token} />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

export function VariableTable({
  items,
  loading,
  onEdit,
}: {
  items: MessageVariableRow[];
  loading: boolean;
  onEdit: (variable: MessageVariableRow) => void;
}): ReactNode {
  const archiveVariable = useArchiveEmailVariable();
  async function archive(variable: MessageVariableRow) {
    try {
      await archiveVariable.mutateAsync({ id: variable.id });
      toast.success("メッセージ変数をアーカイブしました");
    } catch (caught) {
      toast.error(getErrorMessage(caught, "アーカイブできませんでした"));
    }
  }

  const columns: DataTableColumn<MessageVariableRow>[] = [
    {
      key: "name",
      header: "名前",
      cell: (variable) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{variable.name}</span>
          {variable.description ? (
            <span className="text-xs text-muted-foreground">{variable.description}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "token",
      header: "変数",
      cell: (variable) => {
        const token = messageVariableToken(variable.key);
        return (
          <div className="flex items-center gap-2">
            <code>{token}</code>
            <CopyButton value={token} />
          </div>
        );
      },
    },
    {
      key: "value",
      header: "値",
      cell: (variable) => variable.value || "空の値",
      cellClassName: "max-w-80 truncate",
    },
    {
      key: "updatedAt",
      header: "更新日",
      cell: (variable) => formatDateTime(variable.updatedAt),
    },
    {
      key: "actions",
      header: "操作",
      cell: (variable) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onEdit(variable)}>
            <Pencil data-icon="inline-start" />
            編集
          </Button>
          <ArchiveConfirm label={variable.name} onConfirm={() => void archive(variable)} />
        </div>
      ),
      headClassName: "text-right",
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border">
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(variable) => variable.id}
        caption="メッセージ変数一覧"
        loading={loading}
        skeletonRowCount={2}
        emptyTitle="メッセージ変数がありません"
        emptyDescription="ブランド名、会社住所、共通署名などを登録できます。"
      />
    </div>
  );
}

function messageVariableToken(key: string): string {
  const normalized = key.replaceAll(/[^A-Za-z0-9_]+/g, "_").toLowerCase();
  return `{{ message.${normalized} }}`;
}
