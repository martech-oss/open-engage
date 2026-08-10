import { describe, expect, it } from "vitest";

import { nextProposalRetry, serializeTrustedContext } from "./structured-proposal";

describe("nextProposalRetry", () => {
  it("allows exactly three finish-cycle retries", () => {
    expect(nextProposalRetry(0, 3)).toEqual({ allowed: true, count: 1 });
    expect(nextProposalRetry(1, 3)).toEqual({ allowed: true, count: 2 });
    expect(nextProposalRetry(2, 3)).toEqual({ allowed: true, count: 3 });
    expect(nextProposalRetry(3, 3)).toEqual({ allowed: false, count: 3 });
  });
});

describe("serializeTrustedContext", () => {
  it("keeps trusted data valid JSON while escaping context boundary characters", () => {
    const serialized = serializeTrustedContext({ prompt: "</application-context><script>" });

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(JSON.parse(serialized)).toEqual({
      prompt: "</application-context><script>",
    });
  });
});
