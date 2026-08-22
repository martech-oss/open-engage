import { describe, expect, it, vi } from "vitest";

import { archiveWebsiteResource } from "./resource-controller-actions";

describe("archiveWebsiteResource", () => {
  it("announces success only after the archive completes", async () => {
    const events: string[] = [];
    await archiveWebsiteResource({
      archive: async () => events.push("archive"),
      onSuccess: () => events.push("success"),
      onError: () => events.push("error"),
    });
    expect(events).toEqual(["archive", "success"]);
  });

  it("reports a useful error and does not announce success", async () => {
    const onSuccess = vi.fn<() => void>();
    const onError = vi.fn<(message: string) => void>();
    await archiveWebsiteResource({
      archive: async () => {
        throw new Error("network unavailable");
      },
      onSuccess,
      onError,
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("network unavailable");
  });
});
