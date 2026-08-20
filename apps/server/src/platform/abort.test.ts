import { describe, expect, it } from "vitest";

import { isAbortError } from "./abort";

describe("isAbortError", () => {
  it("accepts only DOM AbortError instances", () => {
    expect(isAbortError(new DOMException("stopped", "AbortError"))).toBe(true);
    expect(isAbortError(new DOMException("bad state", "InvalidStateError"))).toBe(false);
    expect(isAbortError({ name: "AbortError" })).toBe(false);
  });
});
