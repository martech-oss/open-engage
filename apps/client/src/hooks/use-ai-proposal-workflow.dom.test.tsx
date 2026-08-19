// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAiProposalWorkflow } from "./use-ai-proposal-workflow";

describe("useAiProposalWorkflow", () => {
  it("lets only the later request update proposal state", () => {
    const firstCommit = vi.fn<() => void>();
    const secondCommit = vi.fn<() => void>();
    const { result } = renderHook(() =>
      useAiProposalWorkflow({ open: true, requestKey: "segment-a", onReset: () => undefined }),
    );
    const first = result.current.beginRequest();
    const second = result.current.beginRequest();

    act(() => {
      expect(result.current.acceptProposal(first, firstCommit)).toBe(false);
      expect(result.current.acceptProposal(second, secondCommit)).toBe(true);
    });

    expect(firstCommit).not.toHaveBeenCalled();
    expect(secondCommit).toHaveBeenCalledOnce();
    expect(result.current.canApply).toBe(true);
  });

  it("rejects stale success and stale error after a key change", () => {
    const staleSuccess = vi.fn<() => void>();
    const staleError = vi.fn<() => void>();
    const { result, rerender } = renderHook(
      ({ requestKey }) =>
        useAiProposalWorkflow({ open: true, requestKey, onReset: () => undefined }),
      { initialProps: { requestKey: "company-a" } },
    );
    const token = result.current.beginRequest();

    rerender({ requestKey: "company-b" });
    act(() => {
      expect(result.current.acceptProposal(token, staleSuccess)).toBe(false);
      expect(result.current.acceptCurrent(token, staleError)).toBe(false);
    });

    expect(staleSuccess).not.toHaveBeenCalled();
    expect(staleError).not.toHaveBeenCalled();
    expect(result.current.canApply).toBe(false);
  });

  it("rejects a response from an earlier open session with the same key", () => {
    const staleCommit = vi.fn<() => void>();
    const { result, rerender } = renderHook(
      ({ open }) =>
        useAiProposalWorkflow({ open, requestKey: "email:new", onReset: () => undefined }),
      { initialProps: { open: true } },
    );
    const previousSession = result.current.beginRequest();

    rerender({ open: false });
    rerender({ open: true });
    act(() => {
      expect(result.current.acceptProposal(previousSession, staleCommit)).toBe(false);
    });

    expect(staleCommit).not.toHaveBeenCalled();
    expect(result.current.canApply).toBe(false);
  });

  it("restart invalidates current requests and accepted proposals", () => {
    const staleCommit = vi.fn<() => void>();
    const { result } = renderHook(() =>
      useAiProposalWorkflow({ open: true, requestKey: "automation-a", onReset: () => undefined }),
    );
    const accepted = result.current.beginRequest();
    act(() => {
      expect(result.current.acceptProposal(accepted, () => undefined)).toBe(true);
    });
    expect(result.current.canApply).toBe(true);
    const pending = result.current.beginRequest();

    act(() => result.current.reset());
    act(() => {
      expect(result.current.acceptProposal(pending, staleCommit)).toBe(false);
    });

    expect(staleCommit).not.toHaveBeenCalled();
    expect(result.current.canApply).toBe(false);
  });

  it("unmount invalidates success, error, and finally callbacks", () => {
    const callbacks = [vi.fn<() => void>(), vi.fn<() => void>(), vi.fn<() => void>()];
    const { result, unmount } = renderHook(() =>
      useAiProposalWorkflow({ open: true, requestKey: "brief-a", onReset: () => undefined }),
    );
    const token = result.current.beginRequest();

    unmount();
    expect(result.current.acceptProposal(token, callbacks[0]!)).toBe(false);
    expect(result.current.acceptCurrent(token, callbacks[1]!)).toBe(false);
    expect(result.current.acceptCurrent(token, callbacks[2]!)).toBe(false);
    expect(callbacks.every((callback) => callback.mock.calls.length === 0)).toBe(true);
  });

  it("keeps the last accepted proposal applicable when a newer refinement fails", () => {
    const failure = vi.fn<() => void>();
    const { result } = renderHook(() =>
      useAiProposalWorkflow({ open: true, requestKey: "segment-a", onReset: () => undefined }),
    );
    const accepted = result.current.beginRequest();
    act(() => {
      result.current.acceptProposal(accepted, () => undefined);
    });

    const refinement = result.current.beginRequest();
    act(() => {
      expect(result.current.acceptCurrent(refinement, failure)).toBe(true);
    });

    expect(failure).toHaveBeenCalledOnce();
    expect(result.current.canApply).toBe(true);
  });
});
