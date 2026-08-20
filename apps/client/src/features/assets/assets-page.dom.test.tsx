// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetSummary, AssetSearch } from "./asset-api";
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

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { items: [asset], total: 1, nextCursor: undefined },
    isFetching: false,
  }),
  useQueryClient: () => ({}),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn<(options: unknown) => Promise<void>>(),
}));
vi.mock("@/hooks/use-debounced-search", () => ({ useDebouncedSearch: () => undefined }));
vi.mock("@/hooks/use-cursor-pagination", () => ({
  useCursorPagination: () => ({
    cursor: undefined,
    hasPreviousPage: false,
    goToNextPage: vi.fn<(nextCursor?: string) => void>(),
    goToPreviousPage: vi.fn<() => void>(),
  }),
}));

vi.mock("@/components/data-table", () => ({
  DataTable: ({
    columns,
    rows,
  }: {
    columns: Array<{ key: string; cell: (row: AssetSummary) => ReactNode }>;
    rows: AssetSummary[];
  }) => (
    <div>
      {rows.map((row) => (
        <div key={row.id}>{columns.at(-1)?.cell(row)}</div>
      ))}
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
  ArchiveConfirm: ({ label }: { label: string }) => (
    <button aria-label={`${label}をアーカイブ`}>archive</button>
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
  AssetDeleteConfirm: ({ name }: { name: string }) => (
    <button aria-label={`${name}を削除`}>delete</button>
  ),
  AssetEditDialog: () => null,
  AssetReplaceDialog: () => null,
  AssetUploadDialog: () => null,
}));

vi.mock("./asset-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./asset-api")>();
  const mutation = () => ({ mutateAsync: vi.fn<(input: unknown) => Promise<void>>() });
  return {
    ...original,
    assetsQueryOptions: () => ({}),
    invalidateAssetsList: () => Promise.resolve(),
    useUpdateAsset: mutation,
    useArchiveAsset: mutation,
    useRestoreAsset: mutation,
    useDeleteAsset: mutation,
  };
});

afterEach(cleanup);

describe("AssetsPage role actions", () => {
  it.each([
    {
      role: "viewer" as const,
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
  ])("shows the permitted actions for $role", ({ role, upload, visible, hidden }) => {
    render(<AssetsPage initialSearch={search()} role={role} />);

    expect(screen.queryByRole("button", { name: "アップロード" }) !== null).toBe(upload);
    for (const name of visible) expect(screen.getByLabelText(name)).toBeTruthy();
    for (const name of hidden) expect(screen.queryByLabelText(name)).toBeNull();
  });
});

function search(): AssetSearch {
  return { q: "", kind: "", status: "active", view: "table" };
}
