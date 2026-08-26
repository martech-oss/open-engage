// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactSummary } from "@openengage/core/contacts";

import { type ContactSearch, contactSearchDefaults } from "./contact-api";
import type * as ContactApiModule from "./contact-api";
import { ContactsPage } from "./contacts-page";

const doubles = vi.hoisted(() => ({
  bulkUpdateContacts: vi.fn<(input: unknown) => Promise<void>>(),
  startContactExport: vi.fn<(input: unknown) => Promise<{ jobId: string }>>(),
  getContactDataJob: vi.fn<(jobId: string) => Promise<Record<string, unknown>>>(),
  downloadContactExport: vi.fn<(jobId: string) => Promise<File>>(),
  exportCsv: vi.fn<() => void>(),
  saveFile: vi.fn<(file: File) => void>(),
}));

const contact: ContactSummary = {
  id: "contact-a",
  workspaceId: "workspace-a",
  visitorId: null,
  email: "a@example.com",
  firstName: "Alice",
  lastName: "A",
  phone: null,
  externalId: null,
  stage: "lead",
  score: 10,
  gradePoints: 0,
  status: "active",
  archivedAt: null,
  customFields: {},
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  tags: [],
  companies: [],
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { items: [contact], total: 1, nextCursor: "page-2" },
    error: null,
    isFetching: false,
  }),
  useQueryClient: () => ({}),
  useSuspenseQuery: () => ({
    data: {
      stages: [],
      tags: [{ id: "tag-a", name: "Priority", color: "#ff0000" }],
      companies: [],
      segments: [],
    },
    error: null,
  }),
}));

vi.mock("./contact-bits", () => ({
  ContactAvatar: () => null,
  ContactScoreBadge: () => null,
  ContactStatusDot: () => null,
  contactName: (value: ContactSummary) =>
    [value.firstName, value.lastName].filter(Boolean).join(" ") || value.email || "Unknown",
  ControlledSelect: ({
    value,
    onValueChange,
    placeholder,
    options,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    placeholder: string;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select
      aria-label={placeholder}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/components/app-ui", () => ({
  ErrorAlert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormInput: () => null,
  FormNativeSelect: () => null,
  PageLayout: ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
    <main>
      {action}
      {children}
    </main>
  ),
}));

vi.mock("@/components/data-table", () => ({
  DataTable: ({
    columns,
    rows,
    pagination,
  }: {
    columns: Array<{ cell: (row: ContactSummary) => ReactNode }>;
    rows: ContactSummary[];
    pagination: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      onNext: () => void;
      onPrevious: () => void;
    };
  }) => (
    <div>
      {rows.map((row) => (
        <div key={row.id}>{columns[0]?.cell(row)}</div>
      ))}
      <button disabled={!pagination.hasPreviousPage} onClick={pagination.onPrevious}>
        前へ
      </button>
      <button disabled={!pagination.hasNextPage} onClick={pagination.onNext}>
        次へ
      </button>
    </div>
  ),
}));

vi.mock("./contact-api", async (importOriginal) => {
  const original = await importOriginal<typeof ContactApiModule>();
  return {
    ...original,
    bulkUpdateContacts: doubles.bulkUpdateContacts,
    startContactExport: doubles.startContactExport,
    getContactDataJob: doubles.getContactDataJob,
    downloadContactExport: doubles.downloadContactExport,
    contactOptionsQueryOptions: () => ({}),
    contactsQueryOptions: () => ({}),
    invalidateContactOptions: () => Promise.resolve(),
    invalidateContactsList: () => Promise.resolve(),
  };
});

vi.mock("./contact-filters", () => ({
  useContactFilters: (search: ContactSearch) => ({
    query: search.q,
    setQuery: vi.fn<(value: string) => void>(),
    status: search.status,
    setStatus: vi.fn<(value: string) => void>(),
    stage: search.stage,
    setStage: vi.fn<(value: string) => void>(),
    tagId: search.tagId,
    setTagId: vi.fn<(value: string) => void>(),
    companyId: search.companyId,
    setCompanyId: vi.fn<(value: string) => void>(),
    segmentId: search.segmentId,
    setSegmentId: vi.fn<(value: string) => void>(),
    scoreMin: search.scoreMin,
    setScoreMin: vi.fn<(value: string) => void>(),
    scoreMax: search.scoreMax,
    setScoreMax: vi.fn<(value: string) => void>(),
    sort: search.sort,
    setSort: vi.fn<(value: string) => void>(),
    direction: search.direction,
    setDirection: vi.fn<(value: string) => void>(),
    clearFilters: vi.fn<() => void>(),
  }),
}));

vi.mock("@/lib/csv", () => ({
  exportCsv: doubles.exportCsv,
  saveFile: doubles.saveFile,
}));

vi.mock("./contact-forms", () => ({
  ContactCreateForm: () => null,
  SegmentSaveForm: () => null,
}));
vi.mock("./contact-drawer", () => ({ ContactDrawer: () => null }));
vi.mock("./segment-filter", () => ({ createSegmentFilter: () => null }));
vi.mock("@/features/segments/segment-api", () => ({ refreshSegment: () => Promise.resolve() }));
vi.mock("./contacts-toolbar", () => ({
  ContactsToolbar: () => null,
  BulkActionBar: ({
    count,
    children,
  }: {
    count: number;
    children: ReactNode;
    onClear: () => void;
  }) => (
    <section>
      <span>{count}件を選択中</span>
      {children}
    </section>
  ),
}));

beforeEach(() => {
  doubles.bulkUpdateContacts.mockReset().mockResolvedValue(undefined);
  doubles.startContactExport.mockReset();
  doubles.getContactDataJob.mockReset();
  doubles.downloadContactExport.mockReset();
  doubles.exportCsv.mockReset();
  doubles.saveFile.mockReset();
});

afterEach(cleanup);

describe("ContactsPage keyed selection", () => {
  it("does not resurrect selected IDs or expose a bulk action after an immediate A → B → A", () => {
    const searchA = search("alpha");
    const searchB = search("beta");
    const view = render(<ContactsPage initialSearch={searchA} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Alice Aを選択" }));
    expect(screen.getByText("1件を選択中")).toBeTruthy();

    view.rerender(<ContactsPage initialSearch={searchB} />);
    view.rerender(<ContactsPage initialSearch={searchA} />);

    expect(screen.queryByText("1件を選択中")).toBeNull();
    expect(screen.queryByRole("button", { name: "アーカイブ" })).toBeNull();
    expect(doubles.bulkUpdateContacts).not.toHaveBeenCalled();
  });

  it("requires a bulk resource before applying and submits it after selection", async () => {
    render(<ContactsPage initialSearch={search("alpha")} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Alice Aを選択" }));
    fireEvent.click(screen.getByRole("button", { name: "タグを追加" }));

    fireEvent.click(screen.getByRole("button", { name: "適用" }));
    expect(screen.getByText("一括操作の対象を選択してください")).toBeTruthy();
    expect(doubles.bulkUpdateContacts).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("タグを選択"), { target: { value: "tag-a" } });
    fireEvent.click(screen.getByRole("button", { name: "適用" }));

    await waitFor(() =>
      expect(doubles.bulkUpdateContacts).toHaveBeenCalledWith({
        contactIds: ["contact-a"],
        action: "add_tag",
        resourceId: "tag-a",
      }),
    );
  });

  it("resets the bulk action and resource across an immediate filter A → B → A", () => {
    const searchA = search("alpha");
    const searchB = search("beta");
    const view = render(<ContactsPage initialSearch={searchA} />);
    chooseTagBulkAction();

    view.rerender(<ContactsPage initialSearch={searchB} />);
    view.rerender(<ContactsPage initialSearch={searchA} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Alice Aを選択" }));

    expect(screen.queryByLabelText("タグを選択")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "タグを追加" }));
    expect(screen.getByLabelText("タグを選択")).toHaveProperty("value", "");
  });

  it.each(["次へ", "前へ"])("resets the bulk action and resource on %s navigation", (direction) => {
    render(<ContactsPage initialSearch={search("alpha")} />);
    if (direction === "前へ") fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    chooseTagBulkAction();

    fireEvent.click(screen.getByRole("button", { name: direction }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Alice Aを選択" }));

    expect(screen.queryByLabelText("タグを選択")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "タグを追加" }));
    expect(screen.getByLabelText("タグを選択")).toHaveProperty("value", "");
  });
});

describe("ContactsPage export controller", () => {
  it("sends only normalized active filters to the server job and saves its completed File", async () => {
    const file = new File(["server csv"], "contacts.csv", { type: "text/csv" });
    doubles.startContactExport.mockResolvedValue({ jobId: "export-job" });
    doubles.getContactDataJob.mockResolvedValue(dataJob("completed", 72));
    doubles.downloadContactExport.mockResolvedValue(file);
    render(
      <ContactsPage
        initialSearch={{
          ...contactSearchDefaults,
          q: "  needle  ",
          stage: "customer",
          tagId: "tag-a",
          companyId: "company-a",
          segmentId: "segment-a",
          scoreMin: "10",
          scoreMax: "90",
          sort: "email",
          direction: "asc",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "エクスポート" }));

    await waitFor(() =>
      expect(doubles.startContactExport).toHaveBeenCalledWith({
        filter: {
          query: "needle",
          status: "active",
          stage: "customer",
          tagId: "tag-a",
          companyId: "company-a",
          segmentId: "segment-a",
          scoreMin: 10,
          scoreMax: 90,
        },
      }),
    );
    await waitFor(() => expect(doubles.saveFile).toHaveBeenCalledWith(file));
    expect(doubles.getContactDataJob).toHaveBeenCalledWith("export-job");
    expect(doubles.downloadContactExport).toHaveBeenCalledWith("export-job");
    expect(doubles.exportCsv).not.toHaveBeenCalled();
  });

  it("shows server progress and cancels the next poll when the page unmounts", async () => {
    vi.useFakeTimers();
    try {
      doubles.startContactExport.mockResolvedValue({ jobId: "pending-job" });
      doubles.getContactDataJob.mockResolvedValue(dataJob("processing", 12));
      const view = render(<ContactsPage initialSearch={contactSearchDefaults} />);

      fireEvent.click(screen.getByRole("button", { name: "エクスポート" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText("エクスポート中（12件）")).toBeTruthy();
      expect(doubles.getContactDataJob).toHaveBeenCalledTimes(1);
      view.unmount();
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      expect(doubles.getContactDataJob).toHaveBeenCalledTimes(1);
      expect(doubles.downloadContactExport).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes a failed export and retries the whole job", async () => {
    const file = new File(["retried csv"], "contacts.csv", { type: "text/csv" });
    doubles.startContactExport
      .mockRejectedValueOnce(new Error("export unavailable"))
      .mockResolvedValueOnce({ jobId: "retry-job" });
    doubles.getContactDataJob.mockResolvedValue(dataJob("completed", 1));
    doubles.downloadContactExport.mockResolvedValue(file);
    render(<ContactsPage initialSearch={contactSearchDefaults} />);

    fireEvent.click(screen.getByRole("button", { name: "エクスポート" }));
    expect(await screen.findByText("export unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));

    await waitFor(() => expect(doubles.startContactExport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(doubles.saveFile).toHaveBeenCalledWith(file));
  });

  it("stops polling and surfaces the persisted terminal export error", async () => {
    doubles.startContactExport.mockResolvedValue({ jobId: "failed-job" });
    doubles.getContactDataJob.mockResolvedValue(dataJob("failed", 0, "Export part 0 is missing"));
    render(<ContactsPage initialSearch={contactSearchDefaults} />);

    fireEvent.click(screen.getByRole("button", { name: "エクスポート" }));

    expect(await screen.findByText("Export part 0 is missing")).toBeTruthy();
    expect(doubles.getContactDataJob).toHaveBeenCalledTimes(1);
    expect(doubles.downloadContactExport).not.toHaveBeenCalled();
  });
});

function chooseTagBulkAction(): void {
  fireEvent.click(screen.getByRole("checkbox", { name: "Alice Aを選択" }));
  fireEvent.click(screen.getByRole("button", { name: "タグを追加" }));
  fireEvent.change(screen.getByLabelText("タグを選択"), { target: { value: "tag-a" } });
  expect(screen.getByLabelText("タグを選択")).toHaveProperty("value", "tag-a");
}

function search(q: string): ContactSearch {
  return { ...contactSearchDefaults, q };
}

function dataJob(status: string, processed: number, error: string | null = null) {
  return {
    id: "export-job",
    kind: "contact_export",
    status,
    processed,
    succeeded: processed,
    failed: 0,
    attempts: 1,
    error,
    errorManifestKey: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}
