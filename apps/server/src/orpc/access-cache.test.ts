import { describe, expect, it, vi } from "vitest";

import { createRequestAccessCache } from "./access-cache";

describe("createRequestAccessCache", () => {
  it("shares one in-flight workspace resolution across a request", async () => {
    let release!: (value: { workspace: string }) => void;
    const workspace = vi.fn<() => Promise<{ workspace: string }>>(
      () =>
        new Promise<{ workspace: string }>((resolve) => {
          release = resolve;
        }),
    );
    const access = createRequestAccessCache({
      workspace,
      sessionWorkspace: async () => ({ workspace: "session" }),
      session: async () => ({ session: "viewer" }),
    });

    const first = access.workspace();
    const second = access.workspace();
    release({ workspace: "cached" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { workspace: "cached" },
      { workspace: "cached" },
    ]);
    expect(workspace).toHaveBeenCalledTimes(1);
  });

  it("keeps the three authorization modes isolated", async () => {
    const workspace = vi.fn<() => Promise<{ mode: "workspace" }>>(async () => ({
      mode: "workspace",
    }));
    const sessionWorkspace = vi.fn<() => Promise<{ mode: "session-workspace" }>>(async () => ({
      mode: "session-workspace",
    }));
    const session = vi.fn<() => Promise<{ mode: "session" }>>(async () => ({
      mode: "session",
    }));
    const access = createRequestAccessCache({ workspace, sessionWorkspace, session });

    await expect(
      Promise.all([
        access.workspace(),
        access.sessionWorkspace(),
        access.session(),
        access.workspace(),
        access.sessionWorkspace(),
        access.session(),
      ]),
    ).resolves.toEqual([
      { mode: "workspace" },
      { mode: "session-workspace" },
      { mode: "session" },
      { mode: "workspace" },
      { mode: "session-workspace" },
      { mode: "session" },
    ]);
    expect(workspace).toHaveBeenCalledTimes(1);
    expect(sessionWorkspace).toHaveBeenCalledTimes(1);
    expect(session).toHaveBeenCalledTimes(1);
  });
});
