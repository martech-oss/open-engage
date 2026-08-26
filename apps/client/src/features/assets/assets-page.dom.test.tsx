// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceCapabilities } from "@openengage/core/workspaces";

import type { AssetSummary, AssetSearch } from "./asset-api";
import type * as AssetApiModule from "./asset-api";
import { AssetsPage } from "./assets-page";

const asset: AssetSummary = {
  id: "asset-a",
  name: "Brand guide",
  originalFilename: "brand.pdf",
  kind: "document",
  contentType: "application/pdf",
  size: 1024,
  width: null,
  height: null,
  visibility: "public",
  publicUrl: "https://example.com/brand.pdf",
  archivedAt: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

const archivedAsset: AssetSummary = {
  ...asset,
  id: "asset-b",
  name: "Archived guide",
  archivedAt: "2026-08-20T01:00:00.000Z",
};

const callbacks = vi.hoisted(() => ({
  goToNextPage: vi.fn<(cursor?: string) => void>(),
  goToPreviousPage: vi.fn<() => void>(),
  invalidateAssetsList: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  restore: vi.fn<(input: unknown) => Promise<void>>().mockResolvedValue(undefined),
  remove: vi.fn<(input: unknown) => Promise<void>>().mockResolvedValue(undefined),
}));
const queryClient = {};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { items: [asset, archivedAsset], total: 2, nextCursor: "next-cursor" },
    isFetching: false,
  }),
  useQueryClient: () => queryClient,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn<(options: unknown) => Promise<void>>(),
}));
vi.mock("@/hooks/use-debounced-search", () => ({ useDebouncedSearch: () => undefined }));
vi.mock("@/hooks/use-cursor-pagination", () => ({
  useCursorPagination: () => ({
    cursor: undefined,
    hasPreviousPage: true,
    goToNextPage: callbacks.goToNextPage,
    goToPreviousPage: callbacks.goToPreviousPage,
  }),
}));

vi.mock("@/components/data-table", () => ({
  DataTable: ({
    columns,
    pagination,
    rows,
  }: {
    columns: Array<{ key: string; cell: (row: AssetSummary) => ReactNode }>;
    pagination: { onNext: () => void; onPrevious: () => void };
    rows: AssetSummary[];
  }) => (
    <div>
      {rows.map((row) => (
        <div key={row.id}>{columns.at(-1)?.cell(row)}</div>
      ))}
      <button onClick={pagination.onPrevious}>前へ</button>
      <button onClick={pagination.onNext}>次へ</button>
    </div>
  ),
}));

vi.mock("@/components/app-ui", () => ({
  PageLayout: ({ action, children }: { action?: ReactNode; children: ReactNode }) => (
    <main>
      {action}
      {children}
    </main>
  ),
  CopyButton: () => <button>URL</button>,
  ArchiveConfirm: ({ label, onConfirm }: { label: string; onConfirm: () => void }) => (
    <button aria-label={`${label}をアーカイブ`} onClick={onConfirm}>
      archive
    </button>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    render,
    onClick,
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    render?: ReactNode;
    onClick?: () => void;
    "aria-label"?: string;
  }) =>
    render ? (
      render
    ) : (
      <button aria-label={ariaLabel} onClick={onClick}>
        {children}
      </button>
    ),
}));

vi.mock("./asset-bits", () => ({
  AssetKindBadge: () => null,
  AssetThumbnail: () => null,
  AssetVisibilityBadge: () => null,
}));

vi.mock("./asset-forms", () => ({
  AssetDeleteConfirm: ({ name, onConfirm }: { name: string; onConfirm: () => void }) => (
    <button aria-label={`${name}を削除`} onClick={onConfirm}>
      delete
    </button>
  ),
  AssetEditDialog: () => null,
  AssetReplaceDialog: () => null,
  AssetUploadDialog: ({
    open,
    onUploaded,
  }: {
    open: boolean;
    onUploaded: (count: number) => void;
  }) => (open ? <button onClick={() => onUploaded(2)}>アップロード完了</button> : null),
}));

vi.mock("./asset-api", async (importOriginal) => {
  const original = await importOriginal<typeof AssetApiModule>();
  const mutation = () => ({ mutateAsync: vi.fn<(input: unknown) => Promise<void>>() });
  return {
    ...original,
    assetsQueryOptions: () => ({}),
    invalidateAssetsList: callbacks.invalidateAssetsList,
    useUpdateAsset: mutation,
    useArchiveAsset: mutation,
    useRestoreAsset: () => ({ mutateAsync: callbacks.restore }),
    useDeleteAsset: () => ({ mutateAsync: callbacks.remove }),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AssetsPage role actions", () => {
  it.each([
    {
      role: "viewer" as const,
      capabilities: capabilities(false, false),
      upload: false,
      visible: ["Brand guideをダウンロード"],
      hidden: [
        "Brand guideを編集",
        "Brand guideを差し替え",
        "Brand guideをアーカイブ",
        "Brand guideを削除",
      ],
    },
    {
      role: "marketer" as const,
      capabilities: capabilities(true, false),
      upload: true,
      visible: [
        "Brand guideをダウンロード",
        "Brand guideを編集",
        "Brand guideを差し替え",
        "Brand guideをアーカイブ",
      ],
      hidden: ["Brand guideを削除"],
    },
    {
      role: "admin" as const,
      capabilities: capabilities(true, true),
      upload: true,
      visible: [
        "Brand guideをダウンロード",
        "Brand guideを編集",
        "Brand guideを差し替え",
        "Brand guideをアーカイブ",
        "Brand guideを削除",
      ],
      hidden: [],
    },
    {
      role: "owner" as const,
      capabilities: capabilities(true, true),
      upload: true,
      visible: [
        "Brand guideをダウンロード",
        "Brand guideを編集",
        "Brand guideを差し替え",
        "Brand guideをアーカイブ",
        "Brand guideを削除",
      ],
      hidden: [],
    },
  ])("shows the permitted actions for $role", ({ capabilities, upload, visible, hidden }) => {
    render(<AssetsPage initialSearch={search()} capabilities={capabilities} />);

    expect(screen.queryByRole("button", { name: "アップロード" }) !== null).toBe(upload);
    for (const name of visible) expect(screen.getByLabelText(name)).toBeTruthy();
    for (const name of hidden) expect(screen.queryByLabelText(name)).toBeNull();
  });

  it("wires pagination, upload refresh, restore, and delete callbacks for an admin", async () => {
    render(<AssetsPage initialSearch={search()} capabilities={capabilities(true, true)} />);

    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "前へ" }));
    expect(callbacks.goToNextPage).toHaveBeenCalledWith("next-cursor");
    expect(callbacks.goToPreviousPage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "アップロード" }));
    fireEvent.click(screen.getByRole("button", { name: "アップロード完了" }));
    await waitFor(() => expect(callbacks.invalidateAssetsList).toHaveBeenCalledWith(queryClient));

    fireEvent.click(screen.getByRole("button", { name: "Archived guideを復元" }));
    fireEvent.click(screen.getByRole("button", { name: "Brand guideを削除" }));
    await waitFor(() => expect(callbacks.restore).toHaveBeenCalledWith({ id: "asset-b" }));
    expect(callbacks.remove).toHaveBeenCalledWith({ id: "asset-a" });
  });
});

function search(): AssetSearch {
  return { q: "", kind: "", status: "active", view: "table" };
}

function capabilities(manageMarketing: boolean, manageWorkspace: boolean): WorkspaceCapabilities {
  return {
    viewReports: manageMarketing,
    manageMarketing,
    manageWorkspace,
    manageApiKeys: manageWorkspace,
  };
}
