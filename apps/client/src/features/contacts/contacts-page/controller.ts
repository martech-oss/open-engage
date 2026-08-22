import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { refreshSegment as refreshSegmentResource } from "@/features/segments/segment-api";
import { useCursorPagination } from "@/hooks/use-cursor-pagination";
import { getErrorMessage, useFormSubmission } from "@/hooks/use-form-submission";
import { saveFile } from "@/lib/csv";
import { useWorkspaceFormatters } from "@/lib/workspace-time";
import type { ContactSummary } from "@openengage/core/contacts";

import {
  buildContactExportFilter,
  bulkUpdateContacts,
  CONTACTS_PAGE_SIZE,
  contactOptionsQueryOptions,
  type ContactSearch,
  contactsQueryOptions,
  downloadContactExport,
  getContactDataJob,
  invalidateContactOptions,
  invalidateContactsList,
  startContactExport,
} from "../contact-api";
import type { BulkAction } from "../contact-bits";
import { useContactFilters } from "../contact-filters";
import { contactColumns } from "../contacts-columns";
import {
  BULK_ACTIONS,
  type BulkActionDefinition,
  contactPaginationKey,
  selectedSegmentFilter,
} from "./model";
import { useKeyedContactSelection } from "./selection";

export function useContactsPageController(initialSearch: ContactSearch) {
  const { formatRelativeTime } = useWorkspaceFormatters();
  const queryClient = useQueryClient();
  const paginationKey = contactPaginationKey(initialSearch);
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
  const filters = useContactFilters(initialSearch);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { selected, setSelected, bulkAction, setBulkAction, bulkResourceId, setBulkResourceId } =
    useKeyedContactSelection(paginationKey);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSegmentSave, setShowSegmentSave] = useState(false);
  const { busy, error, run, setError } = useFormSubmission("操作に失敗しました");
  const [contactExport, setContactExport] = useState<{
    phase: "idle" | "starting" | "polling" | "downloading" | "completed" | "error";
    processed: number;
    error: string;
  }>({ phase: "idle", processed: 0, error: "" });
  const exportRun = useRef(0);
  const exportPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      exportRun.current += 1;
      if (exportPollTimer.current) clearTimeout(exportPollTimer.current);
    },
    [],
  );

  const refreshContacts = useCallback(async () => {
    await invalidateContactsList(queryClient);
    setSelected(new Set());
  }, [queryClient, setSelected]);

  const refreshOptions = useCallback(() => invalidateContactOptions(queryClient), [queryClient]);

  const refreshContactData = useCallback(async () => {
    await Promise.all([refreshContacts(), refreshOptions()]);
  }, [refreshContacts, refreshOptions]);

  function goToNextPage(): void {
    goToNextCursor(nextCursor);
    setSelected(new Set());
  }

  function goToPreviousPage(): void {
    goToPreviousCursor();
    setSelected(new Set());
  }

  async function applyBulkAction(
    action: BulkAction,
    contactIds: string[],
    resourceId?: string,
  ): Promise<void> {
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

  function chooseBulkAction(definition: BulkActionDefinition): void {
    if (!definition.resource) {
      void applyBulkAction(definition.action, [...selected]);
      return;
    }
    setBulkAction(bulkAction === definition.action ? null : definition.action);
    setBulkResourceId("");
  }

  function runSelectedBulkAction(): void {
    const definition = BULK_ACTIONS.find((item) => item.action === bulkAction);
    if (!definition) return;
    if (definition.resource && !bulkResourceId) {
      setError("一括操作の対象を選択してください");
      return;
    }
    void applyBulkAction(definition.action, [...selected], bulkResourceId || undefined);
  }

  async function refreshSegment(): Promise<void> {
    if (!filters.segmentId) return;
    await run(async () => {
      await refreshSegmentResource(filters.segmentId);
      await refreshContactData();
    });
  }

  function exportContacts(): void {
    exportRun.current += 1;
    const runId = exportRun.current;
    if (exportPollTimer.current) clearTimeout(exportPollTimer.current);
    exportPollTimer.current = null;
    setContactExport({ phase: "starting", processed: 0, error: "" });
    const filter = buildContactExportFilter({
      q: filters.query,
      status: filters.status,
      stage: filters.stage,
      tagId: filters.tagId,
      companyId: filters.companyId,
      segmentId: filters.segmentId,
      scoreMin: filters.scoreMin,
      scoreMax: filters.scoreMax,
      sort: filters.sort,
      direction: filters.direction,
    });
    void startContactExport({ filter })
      .then(({ jobId }) => pollContactExport(jobId, runId))
      .catch((caught: unknown) => failContactExport(caught, runId));
  }

  async function pollContactExport(jobId: string, runId: number): Promise<void> {
    try {
      const job = await getContactDataJob(jobId);
      if (exportRun.current !== runId) return;
      if (job.status === "completed") {
        setContactExport({ phase: "downloading", processed: job.processed, error: "" });
        const file = await downloadContactExport(jobId);
        if (exportRun.current !== runId) return;
        saveFile(file);
        setContactExport({ phase: "completed", processed: job.processed, error: "" });
        return;
      }
      if (job.status !== "pending" && job.status !== "processing") {
        failContactExport(new Error("連絡先のエクスポートに失敗しました"), runId);
        return;
      }
      setContactExport({ phase: "polling", processed: job.processed, error: "" });
      exportPollTimer.current = setTimeout(() => {
        void pollContactExport(jobId, runId);
      }, 1_000);
    } catch (caught) {
      failContactExport(caught, runId);
    }
  }

  function failContactExport(caught: unknown, runId: number): void {
    if (exportRun.current !== runId) return;
    setContactExport({
      phase: "error",
      processed: 0,
      error: getErrorMessage(caught, "連絡先のエクスポートに失敗しました"),
    });
  }

  const segmentFilter = selectedSegmentFilter(filters, options);
  const columns = contactColumns({
    contacts,
    formatRelativeTime,
    selected,
    onSelectedChange: setSelected,
    onOpen: (contact: ContactSummary) => setActiveContactId(contact.id),
    onArchive: (contact: ContactSummary) =>
      void applyBulkAction(contact.status === "archived" ? "restore" : "archive", [contact.id]),
  });
  const firstRow = contacts.length === 0 ? 0 : pageIndex * CONTACTS_PAGE_SIZE + 1;
  const lastRow = pageIndex * CONTACTS_PAGE_SIZE + contacts.length;
  const loadError =
    error ||
    (contactsQuery.error || optionsQuery.error
      ? getErrorMessage(contactsQuery.error ?? optionsQuery.error, "連絡先を読み込めませんでした")
      : "");
  const exportBusy = ["starting", "polling", "downloading"].includes(contactExport.phase);
  const exportStatus =
    contactExport.phase === "polling"
      ? `エクスポート中（${contactExport.processed.toLocaleString()}件）`
      : contactExport.phase === "starting"
        ? "エクスポートを開始しています"
        : contactExport.phase === "downloading"
          ? "エクスポートをダウンロードしています"
          : contactExport.phase === "completed"
            ? `エクスポート完了（${contactExport.processed.toLocaleString()}件）`
            : "";

  return {
    contacts,
    options,
    total,
    loading: contactsQuery.isFetching,
    filters,
    advancedOpen,
    toggleAdvanced: () => setAdvancedOpen((open) => !open),
    selected,
    setSelected,
    activeContactId,
    setActiveContactId,
    showCreate,
    setShowCreate,
    showSegmentSave,
    setShowSegmentSave,
    bulkAction,
    bulkResourceId,
    setBulkResourceId,
    busy,
    loadError,
    exportBusy,
    exportError: contactExport.error,
    exportStatus,
    exportButtonLabel: contactExport.phase === "error" ? "再試行" : "エクスポート",
    segmentFilter,
    columns,
    pagination: {
      hasNextPage: Boolean(nextCursor),
      hasPreviousPage,
      onNext: goToNextPage,
      onPrevious: goToPreviousPage,
      rangeLabel: `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} / ${total.toLocaleString()} 件`,
    },
    chooseBulkAction,
    runSelectedBulkAction,
    refreshSegment: () => void refreshSegment(),
    exportContacts,
    refreshContactData,
    refreshOptions,
  };
}
