import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";

import {
  ErrorAlert as ErrorNotice,
  FormInput,
  FormNativeSelect,
  PageLayout as Page,
} from "@/components/app-ui";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelectOption } from "@/components/ui/native-select";
import {
  bulkUpdateContacts,
  CONTACTS_PAGE_SIZE,
  contactOptionsQueryOptions,
  type ContactSearch,
  contactsQueryOptions,
  invalidateContactOptions,
  invalidateContactsList,
} from "@/features/contacts/contact-api";
import { refreshSegment as refreshSegmentResource } from "@/features/segments/segment-api";
import { useCursorPagination } from "@/hooks/use-cursor-pagination";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { exportCsv } from "@/lib/csv";
import { formatLongDateTime } from "@/lib/format";
import type { ContactSummary } from "@openengage/core/contacts";

import { type BulkAction, contactName, ControlledSelect } from "./contact-bits";
import { ContactDrawer } from "./contact-drawer";
import { useContactFilters } from "./contact-filters";
import { ContactCreateForm, SegmentSaveForm } from "./contact-forms";
import { contactColumns } from "./contacts-columns";
import { BulkActionBar, ContactsToolbar } from "./contacts-toolbar";
import { createSegmentFilter } from "./segment-filter";

/** The design lists bulk operations inline, so only the common ones get a button. */
const BULK_ACTIONS: Array<{ action: BulkAction; label: string; resource?: "tag" | "segment" }> = [
  { action: "add_tag", label: "タグを追加", resource: "tag" },
  { action: "add_segment", label: "リストへ追加", resource: "segment" },
  { action: "archive", label: "アーカイブ" },
];

export function ContactsPage({ initialSearch }: { initialSearch: ContactSearch }): ReactNode {
  const queryClient = useQueryClient();
  const paginationKey = JSON.stringify([
    initialSearch.q,
    initialSearch.status,
    initialSearch.stage,
    initialSearch.tagId,
    initialSearch.companyId,
    initialSearch.segmentId,
    initialSearch.scoreMin,
    initialSearch.scoreMax,
    initialSearch.sort,
    initialSearch.direction,
  ]);
  const {
    cursor,
    pageIndex,
    hasPreviousPage,
    goToNextPage: goToNextCursor,
    goToPreviousPage: goToPreviousCursor,
  } = useCursorPagination(paginationKey);

  const contactsQuery = useQuery(contactsQueryOptions(initialSearch, cursor));
  const optionsQuery = useSuspenseQuery(contactOptionsQueryOptions());
  const contacts = contactsQuery.data?.items ?? [];
  const options = optionsQuery.data;
  const total = contactsQuery.data?.total ?? 0;
  const nextCursor = contactsQuery.data?.nextCursor;
  const loading = contactsQuery.isFetching;
  const filters = useContactFilters(initialSearch);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>(() => ({
    key: paginationKey,
    ids: new Set(),
  }));
  const selected = selection.key === paginationKey ? selection.ids : new Set<string>();
  const setSelected = useCallback(
    (ids: Set<string>) => setSelection({ key: paginationKey, ids }),
    [paginationKey],
  );
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSegmentSave, setShowSegmentSave] = useState(false);
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkResourceId, setBulkResourceId] = useState("");
  // applyBulkAction/refreshSegment share one busy/error pair, mirroring the
  // pre-DataTable design where both buttons disable together while either is
  // in flight.
  const { busy, error, run, setError } = useFormSubmission("操作に失敗しました");

  const refreshContacts = useCallback(async () => {
    await invalidateContactsList(queryClient);
    setSelected(new Set());
  }, [queryClient, setSelected]);

  const refreshOptions = useCallback(() => invalidateContactOptions(queryClient), [queryClient]);

  const refreshContactData = useCallback(async () => {
    await Promise.all([refreshContacts(), refreshOptions()]);
  }, [refreshContacts, refreshOptions]);

  function goToNextPage() {
    goToNextCursor(nextCursor);
    setSelected(new Set());
  }

  function goToPreviousPage() {
    goToPreviousCursor();
    setSelected(new Set());
  }

  async function applyBulkAction(action: BulkAction, contactIds: string[], resourceId?: string) {
    if (contactIds.length === 0) return;
    await run(async () => {
      await bulkUpdateContacts({
        contactIds,
        action,
        ...(resourceId ? { resourceId } : {}),
      });
      await refreshContactData();
      setBulkAction(null);
      setBulkResourceId("");
    });
  }

  function runSelectedBulkAction() {
    const definition = BULK_ACTIONS.find((item) => item.action === bulkAction);
    if (!definition) return;
    if (definition.resource && !bulkResourceId) {
      setError("一括操作の対象を選択してください");
      return;
    }
    void applyBulkAction(definition.action, [...selected], bulkResourceId || undefined);
  }

  async function refreshSegment() {
    if (!filters.segmentId) return;
    await run(async () => {
      await refreshSegmentResource(filters.segmentId);
      await refreshContactData();
    });
  }

  function buildSegmentFilter() {
    return createSegmentFilter(
      {
        q: filters.query,
        status: filters.status,
        stage: filters.stage,
        tagId: filters.tagId,
        companyId: filters.companyId,
        scoreMin: filters.scoreMin,
        scoreMax: filters.scoreMax,
      },
      options,
    );
  }

  function exportContacts() {
    exportCsv(
      "contacts.csv",
      contacts.map((contact) => ({
        名前: contactName(contact),
        メール: contact.email ?? "",
        電話番号: contact.phone ?? "",
        状態: contact.status,
        ステージ: contact.stage,
        会社: contact.companies.map((company) => company.name).join(" / "),
        タグ: contact.tags.map((tag) => tag.name).join(" / "),
        スコア: contact.score,
        更新日: formatLongDateTime(contact.updatedAt),
      })),
    );
  }

  const columns = contactColumns({
    contacts,
    selected,
    onSelectedChange: setSelected,
    onOpen: (contact: ContactSummary) => setActiveContactId(contact.id),
    onArchive: (contact: ContactSummary) =>
      void applyBulkAction(contact.status === "archived" ? "restore" : "archive", [contact.id]),
  });
  const firstRow = contacts.length === 0 ? 0 : pageIndex * CONTACTS_PAGE_SIZE + 1;
  const lastRow = pageIndex * CONTACTS_PAGE_SIZE + contacts.length;

  return (
    <Page
      title="連絡先"
      fill
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportContacts}>
            <Download data-icon="inline-start" />
            エクスポート
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus data-icon="inline-start" />
            連絡先を追加
          </Button>
        </div>
      }
    >
      <Card className="min-h-0 flex-1 gap-0 py-0">
        <ContactsToolbar
          filters={filters}
          options={options}
          total={total}
          advancedOpen={advancedOpen}
          onToggleAdvanced={() => setAdvancedOpen((open) => !open)}
          onSaveSegment={() => setShowSegmentSave(true)}
          canSaveSegment={Boolean(buildSegmentFilter()) && !filters.segmentId}
          onRefreshSegment={() => void refreshSegment()}
          onExport={exportContacts}
          busy={busy}
        />

        {advancedOpen && (
          <div className="grid shrink-0 gap-3 border-b bg-secondary/50 p-3.5 md:grid-cols-2 xl:grid-cols-5">
            <FormNativeSelect
              label="ステージ"
              name="stage-filter"
              value={filters.stage}
              onChange={(event) => filters.setStage(event.target.value)}
            >
              <NativeSelectOption value="">すべて</NativeSelectOption>
              {options.stages.map((item) => (
                <NativeSelectOption key={item.stage} value={item.stage}>
                  {item.stage} ({item.contactCount})
                </NativeSelectOption>
              ))}
            </FormNativeSelect>
            <FormNativeSelect
              label="タグ"
              name="tag-filter"
              value={filters.tagId}
              onChange={(event) => filters.setTagId(event.target.value)}
            >
              <NativeSelectOption value="">すべて</NativeSelectOption>
              {options.tags.map((tag) => (
                <NativeSelectOption key={tag.id} value={tag.id}>
                  {tag.name}
                </NativeSelectOption>
              ))}
            </FormNativeSelect>
            <FormNativeSelect
              label="会社"
              name="company-filter"
              value={filters.companyId}
              onChange={(event) => filters.setCompanyId(event.target.value)}
            >
              <NativeSelectOption value="">すべて</NativeSelectOption>
              {options.companies.map((company) => (
                <NativeSelectOption key={company.id} value={company.id}>
                  {company.name}
                </NativeSelectOption>
              ))}
            </FormNativeSelect>
            <FormInput
              label="スコア下限"
              name="scoreMin-filter"
              type="number"
              value={filters.scoreMin}
              onChange={(event) => filters.setScoreMin(event.target.value)}
            />
            <FormInput
              label="スコア上限"
              name="scoreMax-filter"
              type="number"
              value={filters.scoreMax}
              onChange={(event) => filters.setScoreMax(event.target.value)}
            />
          </div>
        )}

        {selected.size > 0 && (
          <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
            {BULK_ACTIONS.map((item) => (
              <Button
                key={item.action}
                variant={bulkAction === item.action ? "secondary" : "ghost"}
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (!item.resource) {
                    void applyBulkAction(item.action, [...selected]);
                    return;
                  }
                  setBulkAction(bulkAction === item.action ? null : item.action);
                  setBulkResourceId("");
                }}
              >
                {item.label}
              </Button>
            ))}
            {bulkAction === "add_tag" && (
              <ControlledSelect
                value={bulkResourceId}
                onValueChange={setBulkResourceId}
                placeholder="タグを選択"
                options={options.tags.map((tag) => ({ value: tag.id, label: tag.name }))}
              />
            )}
            {bulkAction === "add_segment" && (
              <ControlledSelect
                value={bulkResourceId}
                onValueChange={setBulkResourceId}
                placeholder="リストを選択"
                options={options.segments
                  .filter((segment) => segment.kind === "static")
                  .map((segment) => ({ value: segment.id, label: segment.name }))}
              />
            )}
            {bulkAction && (
              <Button size="sm" disabled={busy} onClick={runSelectedBulkAction}>
                適用
              </Button>
            )}
          </BulkActionBar>
        )}

        {(error || contactsQuery.error || optionsQuery.error) && (
          <div className="shrink-0 border-b p-3.5">
            <ErrorNotice>
              {error ||
                getErrorMessage(
                  contactsQuery.error ?? optionsQuery.error,
                  "連絡先を読み込めませんでした",
                )}
            </ErrorNotice>
          </div>
        )}

        <DataTable
          compact
          showColumnVisibility
          columns={columns}
          rows={contacts}
          rowKey={(contact) => contact.id}
          caption="連絡先一覧"
          loading={loading}
          skeletonRowCount={12}
          emptyTitle="条件に一致する連絡先がありません"
          emptyDescription="検索条件を変更するか、新しい連絡先を追加してください。"
          onRowClick={(contact) => setActiveContactId(contact.id)}
          className="min-w-[900px]"
          containerClassName="min-h-0 flex-1 overflow-y-auto"
          pagination={{
            hasNextPage: Boolean(nextCursor),
            hasPreviousPage,
            onNext: goToNextPage,
            onPrevious: goToPreviousPage,
            rangeLabel: `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} / ${total.toLocaleString()} 件`,
          }}
        />
      </Card>

      <ContactCreateForm
        open={showCreate}
        onOpenChange={setShowCreate}
        options={options}
        onSaved={async () => {
          setShowCreate(false);
          await refreshContactData();
        }}
      />
      <SegmentSaveForm
        open={showSegmentSave}
        onOpenChange={setShowSegmentSave}
        filter={buildSegmentFilter()}
        onSaved={async () => {
          setShowSegmentSave(false);
          await refreshOptions();
        }}
      />
      {activeContactId && (
        <ContactDrawer
          contactId={activeContactId}
          options={options}
          onClose={() => setActiveContactId(null)}
          onChanged={refreshContactData}
        />
      )}
    </Page>
  );
}
