// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCursorPagination } from "./use-cursor-pagination";

afterEach(() => vi.restoreAllMocks());

describe("useCursorPagination", () => {
  it("restores the exact cursor while navigating 1 → 2 → 3 → 2 → 1", () => {
    const { result } = renderHook(() => useCursorPagination("contacts:active"));

    act(() => result.current.goToNextPage("page-2"));
    expect(result.current).toMatchObject({ cursor: "page-2", pageIndex: 1 });

    act(() => result.current.goToNextPage("page-3"));
    expect(result.current).toMatchObject({ cursor: "page-3", pageIndex: 2 });

    act(() => result.current.goToPreviousPage());
    expect(result.current).toMatchObject({ cursor: "page-2", pageIndex: 1 });

    act(() => result.current.goToPreviousPage());
    expect(result.current).toMatchObject({
      cursor: undefined,
      pageIndex: 0,
      hasPreviousPage: false,
    });
  });

  it("does not advance for an absent or self-referential next cursor", () => {
    const { result } = renderHook(() => useCursorPagination("assets:active"));

    act(() => result.current.goToNextPage(undefined));
    expect(result.current).toMatchObject({ cursor: undefined, pageIndex: 0 });

    act(() => result.current.goToNextPage("page-2"));
    act(() => result.current.goToNextPage("page-2"));
    expect(result.current).toMatchObject({ cursor: "page-2", pageIndex: 1 });
  });

  it("exposes the first-page view in the first render for a new key", () => {
    const renders: Array<{
      key: string;
      cursor: string | undefined;
      pageIndex: number;
      hasPreviousPage: boolean;
    }> = [];
    const { result, rerender } = renderHook(
      ({ resetKey }) => {
        const pagination = useCursorPagination(resetKey);
        renders.push({
          key: resetKey,
          cursor: pagination.cursor,
          pageIndex: pagination.pageIndex,
          hasPreviousPage: pagination.hasPreviousPage,
        });
        return pagination;
      },
      { initialProps: { resetKey: "contacts:active" } },
    );
    act(() => result.current.goToNextPage("old-page-2"));

    const renderCount = renders.length;
    rerender({ resetKey: "contacts:archived" });

    expect(renders[renderCount]).toEqual({
      key: "contacts:archived",
      cursor: undefined,
      pageIndex: 0,
      hasPreviousPage: false,
    });
  });

  it("commits a mismatched key so an immediate A → B → A cannot resurrect history", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const renders: Array<{
      key: string;
      cursor: string | undefined;
      pageIndex: number;
      hasPreviousPage: boolean;
    }> = [];
    const { result, rerender } = renderHook(
      ({ resetKey }) => {
        const pagination = useCursorPagination(resetKey);
        renders.push({
          key: resetKey,
          cursor: pagination.cursor,
          pageIndex: pagination.pageIndex,
          hasPreviousPage: pagination.hasPreviousPage,
        });
        return pagination;
      },
      { initialProps: { resetKey: "search-a" } },
    );
    act(() => result.current.goToNextPage("search-a-page-2"));

    const beforeMismatch = renders.length;
    rerender({ resetKey: "search-b" });
    expect(renders.slice(beforeMismatch)).toEqual(
      expect.arrayContaining([
        {
          key: "search-b",
          cursor: undefined,
          pageIndex: 0,
          hasPreviousPage: false,
        },
      ]),
    );

    rerender({ resetKey: "search-a" });

    expect(result.current).toMatchObject({
      cursor: undefined,
      pageIndex: 0,
      hasPreviousPage: false,
    });
    expect(errors).not.toHaveBeenCalled();
  });
});
