// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAiProposalWorkflow } from "./use-ai-proposal-workflow";

describe("useAiProposalWorkflow", () => {
  it("resets on close and key changes, rejecting a stale response", () => {
    const onReset = vi.fn<() => void>();
    const { result, rerender, unmount } = renderHook(
      ({ open, workflowKey }) => useAiProposalWorkflow({ open, workflowKey, onReset }),
      { initialProps: { open: true, workflowKey: "segment:create:a" } },
    );
    const stale = result.current.beginRequest();
    act(() => {
      expect(result.current.acceptResponse(stale, () => undefined)).toBe(true);
    });
    expect(result.current.canApply).toBe(true);

    rerender({ open: true, workflowKey: "segment:create:b" });
    expect(result.current.canApply).toBe(false);
    act(() => {
      expect(result.current.acceptResponse(stale, () => undefined)).toBe(false);
    });

    rerender({ open: false, workflowKey: "segment:create:b" });
    expect(result.current.canApply).toBe(false);
    expect(onReset).toHaveBeenCalled();

    rerender({ open: true, workflowKey: "segment:create:c" });
    const afterClose = result.current.beginRequest();
    unmount();
    expect(result.current.acceptResponse(afterClose, () => undefined)).toBe(false);
  });

  it("does not revive an old proposal after a dialog is closed and reopened", () => {
    const commit = vi.fn<() => void>();
    const { result, rerender } = renderHook(
      ({ open, session }) =>
        useAiProposalWorkflow({
          open,
          workflowKey: `project-brief:create:${session}`,
          onReset: () => undefined,
        }),
      { initialProps: { open: true, session: 1 } },
    );
    const previousSession = result.current.beginRequest();

    rerender({ open: false, session: 1 });
    rerender({ open: true, session: 2 });

    act(() => {
      expect(result.current.acceptResponse(previousSession, commit)).toBe(false);
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.canApply).toBe(false);
  });
});
