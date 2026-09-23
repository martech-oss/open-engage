// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUrlSearchDraft } from "./use-url-search-draft";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useUrlSearchDraft", () => {
  it("commits typing once and keeps later keystrokes when its own commit lands", () => {
    const onCommit = vi.fn<(value: string) => void>();
    const { result, rerender } = renderHook(
      ({ value }) => useUrlSearchDraft({ value, onCommit, delayMs: 100 }),
      { initialProps: { value: "" } },
    );

    act(() => result.current[1]("ac"));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onCommit).toHaveBeenCalledWith("ac");

    act(() => result.current[1]("acm"));
    rerender({ value: "ac" });
    expect(result.current[0]).toBe("acm");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onCommit.mock.calls).toEqual([["ac"], ["acm"]]);
  });

  it("replaces the draft when the URL changes from elsewhere", () => {
    const onCommit = vi.fn<(value: string) => void>();
    const { result, rerender } = renderHook(
      ({ value }) => useUrlSearchDraft({ value, onCommit, delayMs: 100 }),
      { initialProps: { value: "acme" } },
    );

    rerender({ value: "" });
    expect(result.current[0]).toBe("");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
