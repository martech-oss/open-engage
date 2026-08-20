// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactSummary } from "@openengage/core/contacts";

import { type ContactSearch, contactSearchDefaults } from "./contact-api";
import { ContactsPage } from "./contacts-page";

const doubles = vi.hoisted(() => ({
  bulkUpdateContacts: vi.fn<(input: unknown) => Promise<void>>(),
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
    data: { items: [contact], total: 1, nextCursor: undefined },
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
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/components/data-table", () => ({
  DataTable: ({
    columns,
    rows,
  }: {
    columns: Array<{ cell: (row: ContactSummary) => ReactNode }>;
    rows: ContactSummary[];
  }) => (
    <div>
      {rows.map((row) => (
        <div key={row.id}>{columns[0]?.cell(row)}</div>
      ))}
    </div>
  ),
}));

vi.mock("./contact-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./contact-api")>();
  return {
    ...original,
    bulkUpdateContacts: doubles.bulkUpdateContacts,
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
});

function search(q: string): ContactSearch {
  return { ...contactSearchDefaults, q };
}
