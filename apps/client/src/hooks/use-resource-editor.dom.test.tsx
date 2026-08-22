// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useResourceEditor } from "./use-resource-editor";

describe("useResourceEditor sessions", () => {
  it("gives the same item a fresh editor key after close and reopen", () => {
    const item = { id: "resource-1" };
    const { result } = renderHook(() => useResourceEditor<typeof item>());

    act(() => result.current.openEdit(item));
    const firstKey = result.current.sessionKey;
    act(() => result.current.close());
    act(() => result.current.openEdit(item));

    expect(result.current.sessionKey).not.toBe(firstKey);
  });

  it("gives every repeated create open a fresh editor key", () => {
    const { result } = renderHook(() => useResourceEditor<{ id: string }>());

    act(() => result.current.openCreate());
    const firstKey = result.current.sessionKey;
    act(() => result.current.close());
    act(() => result.current.openCreate());

    expect(result.current.sessionKey).not.toBe(firstKey);
  });
});
