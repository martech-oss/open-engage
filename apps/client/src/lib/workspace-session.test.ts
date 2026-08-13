import { beforeEach, describe, expect, it, vi } from "vitest";

type AuthResult = {
  data: { id: string } | null;
  error: { message?: string } | null;
};

const { setActive, create } = vi.hoisted(() => ({
  setActive: vi.fn<(input: { organizationId: string }) => Promise<AuthResult>>(),
  create: vi.fn<(input: { name: string; slug: string }) => Promise<AuthResult>>(),
}));

vi.mock("@/auth-client", () => ({
  authClient: {
    organization: {
      setActive,
      create,
    },
  },
}));

import {
  activateWorkspace,
  createAndActivateWorkspace,
  listedWorkspaces,
  reloadAfterWorkspaceChange,
} from "@/lib/workspace-session";

describe("listedWorkspaces", () => {
  const current = { id: "ws-1", name: "OpenEngage", slug: "monull" };

  it("keeps the current workspace visible when the list has not loaded", () => {
    expect(listedWorkspaces(current, undefined)).toEqual([current]);
    expect(listedWorkspaces(current, null)).toEqual([current]);
  });

  it("puts the current workspace first and appends other memberships", () => {
    expect(
      listedWorkspaces(current, [
        { id: "ws-2", name: "Client", slug: "client" },
        current,
        { id: "ws-3", name: "Agency", slug: "agency" },
      ]),
    ).toEqual([
      current,
      { id: "ws-2", name: "Client", slug: "client" },
      { id: "ws-3", name: "Agency", slug: "agency" },
    ]);
  });
});

describe("activateWorkspace", () => {
  beforeEach(() => {
    setActive.mockReset();
    create.mockReset();
  });

  it("returns ok after Better Auth sets the active organization", async () => {
    setActive.mockResolvedValue({ data: { id: "ws-2" }, error: null });
    await expect(activateWorkspace("ws-2")).resolves.toEqual({ ok: true });
    expect(setActive).toHaveBeenCalledWith({ organizationId: "ws-2" });
  });

  it("surfaces the Better Auth error message", async () => {
    setActive.mockResolvedValue({ data: null, error: { message: "権限がありません" } });
    await expect(activateWorkspace("ws-2")).resolves.toEqual({ error: "権限がありません" });
  });
});

describe("createAndActivateWorkspace", () => {
  beforeEach(() => {
    setActive.mockReset();
    create.mockReset();
  });

  it("creates an organization then makes it active", async () => {
    create.mockResolvedValue({ data: { id: "ws-new" }, error: null });
    setActive.mockResolvedValue({ data: { id: "ws-new" }, error: null });
    await expect(createAndActivateWorkspace("Acme")).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({ name: "Acme", slug: "acme" });
    expect(setActive).toHaveBeenCalledWith({ organizationId: "ws-new" });
  });

  it("does not activate when create fails", async () => {
    create.mockResolvedValue({ data: null, error: { message: "上限です" } });
    await expect(createAndActivateWorkspace("Acme")).resolves.toEqual({ error: "上限です" });
    expect(setActive).not.toHaveBeenCalled();
  });
});

describe("reloadAfterWorkspaceChange", () => {
  it("clears cached workspace data before navigating to the dashboard", async () => {
    const queryClient = { clear: vi.fn<() => void>() };
    const router = {
      invalidate: vi
        .fn<(opts?: { sync?: boolean }) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const navigate = vi.fn<(opts: { to: "/dashboard"; replace: true }) => void>();

    await reloadAfterWorkspaceChange({ queryClient, router, navigate });

    expect(queryClient.clear).toHaveBeenCalledOnce();
    expect(router.invalidate).toHaveBeenCalledWith({ sync: true });
    expect(navigate).toHaveBeenCalledWith({ to: "/dashboard", replace: true });
    expect(queryClient.clear.mock.invocationCallOrder[0]).toBeLessThan(
      router.invalidate.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
