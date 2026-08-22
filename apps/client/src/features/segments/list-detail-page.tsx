import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Plus, UserMinus, Users } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { EmptyState, FormNativeSelect, FormSelectOption, PageLayout } from "@/components/app-ui";
import { AppDialog, FormDialog } from "@/components/app-ui/dialogs";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  addContactToSegment,
  CONTACTS_PAGE_SIZE,
  contactSearchDefaults,
  contactsQueryOptions,
  invalidateContactsList,
  removeContactFromSegment,
} from "@/features/contacts/contact-api";
import { contactName, contactOptionLabel } from "@/features/contacts/contact-bits";
import { useCursorPagination } from "@/hooks/use-cursor-pagination";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { ContactSummary } from "@openengage/core/contacts";

import {
  invalidateSegmentQueries,
  listMemberOptionsQueryOptions,
  segmentQueryOptions,
} from "./segment-api";
import { SegmentFormDialog } from "./segment-form-dialog";

export function ListDetailPage({ listId }: { listId: string }): ReactNode {
  const { formatDate } = useWorkspaceFormatters();
  const queryClient = useQueryClient();
  const { data: list } = useSuspenseQuery(segmentQueryOptions(listId));
  const { data: contactOptions } = useSuspenseQuery(listMemberOptionsQueryOptions());
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const memberSearch = {
    ...contactSearchDefaults,
    segmentId: listId,
    status: "all" as const,
  };
  const {
    cursor,
    pageIndex,
    hasPreviousPage,
    goToNextPage: goToNextCursor,
    goToPreviousPage: goToPreviousCursor,
  } = useCursorPagination(`list:${listId}`);
  const membersQuery = useQuery(contactsQueryOptions(memberSearch, cursor));
  const members = membersQuery.data?.items ?? [];
  const total = membersQuery.data?.total ?? list.memberCount;
  const nextCursor = membersQuery.data?.nextCursor;
  const firstRow = members.length === 0 ? 0 : pageIndex * CONTACTS_PAGE_SIZE + 1;
  const lastRow = pageIndex * CONTACTS_PAGE_SIZE + members.length;
  const memberIds = new Set(members.map((member) => member.id));
  const availableContacts = contactOptions.items.filter((contact) => !memberIds.has(contact.id));

  async function refreshMembers(): Promise<void> {
    await Promise.all([
      invalidateSegmentQueries(queryClient, listId),
      invalidateContactsList(queryClient),
    ]);
  }

  async function removeMember(contact: ContactSummary): Promise<void> {
    try {
      await removeContactFromSegment(contact.id, listId);
      await refreshMembers();
      toast.success("リストから外しました");
    } catch (caught) {
      toast.error(getErrorMessage(caught, "メンバーを外せませんでした"));
    }
  }

  const columns: DataTableColumn<ContactSummary>[] = [
    {
      key: "contact",
      header: "連絡先",
      sortValue: (contact) => contactName(contact).toLocaleLowerCase(),
      cell: (contact) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{contactName(contact)}</span>
          <span className="text-xs text-muted-foreground">
            {contact.email ?? contact.phone ?? contact.externalId ?? "識別子なし"}
          </span>
        </div>
      ),
      headClassName: "px-4",
      cellClassName: "px-4",
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
      key: "updatedAt",
      header: "更新日",
      sortValue: (contact) => contact.updatedAt,
      cell: (contact) => formatDate(contact.updatedAt),
      headClassName: "text-right",
      cellClassName: "text-right text-muted-foreground",
    },
    {
      key: "actions",
      header: "操作",
      enableHiding: false,
      cell: (contact) => (
        <Button variant="ghost" size="sm" onClick={() => void removeMember(contact)}>
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
      title={list.name}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/lists" />}>
            <ArrowLeft data-icon="inline-start" />
            一覧
          </Button>
          <Button onClick={() => setEditOpen(true)}>
            <Pencil data-icon="inline-start" />
            編集
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus data-icon="inline-start" />
            メンバーを追加
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>連絡先</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {list.memberCount.toLocaleString()}人
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>選定元</CardDescription>
            <CardTitle>{list.membershipSource ?? "手動選定"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>更新日</CardDescription>
            <CardTitle>{formatDate(list.updatedAt)}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      {list.description ? (
        <Card>
          <CardHeader>
            <CardDescription>説明</CardDescription>
            <CardTitle className="text-base font-medium">{list.description}</CardTitle>
          </CardHeader>
        </Card>
      ) : null}
      <Card className="py-0">
        <CardContent className="px-0">
          <DataTable
            showColumnVisibility
            columns={columns}
            rows={members}
            rowKey={(contact) => contact.id}
            caption={`${list.name}のメンバー`}
            loading={membersQuery.isFetching}
            emptyTitle="メンバーがいません"
            emptyDescription="このリストに入れる連絡先を追加してください。"
            emptyAction={
              <Button variant="outline" onClick={() => setAddOpen(true)}>
                <Users data-icon="inline-start" />
                メンバーを追加
              </Button>
            }
            pagination={{
              hasNextPage: Boolean(nextCursor),
              hasPreviousPage,
              onNext: () => goToNextCursor(nextCursor),
              onPrevious: goToPreviousCursor,
              rangeLabel: `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} / ${total.toLocaleString()} 件`,
            }}
          />
        </CardContent>
      </Card>
      <SegmentFormDialog
        key={`${list.id}-${editOpen}`}
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={list}
        kind="static"
      />
      <AddListMemberForm
        open={addOpen}
        onOpenChange={setAddOpen}
        contacts={availableContacts}
        onSubmit={async (contactId) => {
          await addContactToSegment(contactId, listId);
          await refreshMembers();
          toast.success("メンバーを追加しました");
          setAddOpen(false);
        }}
      />
    </PageLayout>
  );
}

function AddListMemberForm({
  open,
  onOpenChange,
  contacts,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: ContactSummary[];
  onSubmit: (contactId: string) => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("メンバーを追加できませんでした");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const contactId = getFormString(new FormData(event.currentTarget), "contactId");
    if (!contactId) return;
    await run(async () => {
      await onSubmit(contactId);
    });
  }

  if (contacts.length === 0) {
    return (
      <AppDialog
        open={open}
        onOpenChange={onOpenChange}
        title="メンバーを追加"
        description="リストに入れる連絡先を選びます。"
      >
        <EmptyState
          compact
          title="追加できる連絡先がありません"
          description="表示中の候補はすべてこのリストに入っています。"
        />
      </AppDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="メンバーを追加"
      description="リストに入れる連絡先を選びます。"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel="追加"
    >
      <FormNativeSelect label="連絡先" name="contactId" required>
        <FormSelectOption value="">選択してください</FormSelectOption>
        {contacts.map((contact) => (
          <FormSelectOption key={contact.id} value={contact.id}>
            {contactOptionLabel(contact)}
          </FormSelectOption>
        ))}
      </FormNativeSelect>
    </FormDialog>
  );
}
