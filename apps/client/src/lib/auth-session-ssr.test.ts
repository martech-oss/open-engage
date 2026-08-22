import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  bindingFetch: vi.fn<(request: Request) => Promise<Response>>(),
  browserSession: vi.fn<() => Promise<{ data: unknown }>>(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    SERVER: { fetch: testState.bindingFetch },
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () =>
    new Headers({
      cookie: "session=ssr-cookie",
      "x-request-id": "request-123",
    }),
  getRequestUrl: () => new URL("https://client.example.test/login"),
}));

vi.mock("@/auth-client", () => ({
  authClient: { getSession: testState.browserSession },
}));

describe("SSR auth session", () => {
  beforeEach(() => {
    testState.bindingFetch.mockReset();
    testState.browserSession.mockReset();
  });

  it("reads Better Auth through SERVER.fetch with the inbound cookie", async () => {
    const session = {
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: "person@example.test", name: "Person" },
    };
    testState.bindingFetch.mockResolvedValue(
      Response.json(session, { headers: { "content-type": "application/json" } }),
    );
    testState.browserSession.mockResolvedValue({ data: null });

    const { getCurrentSession } = await import("./auth-session");
    await expect(getCurrentSession()).resolves.toEqual(session);

    expect(testState.browserSession).not.toHaveBeenCalled();
    expect(testState.bindingFetch).toHaveBeenCalledOnce();
    const request = testState.bindingFetch.mock.calls[0]![0];
    expect(new URL(request.url).pathname).toBe("/api/auth/get-session");
    expect(request.headers.get("cookie")).toBe("session=ssr-cookie");
    expect(request.headers.get("x-request-id")).toBe("request-123");
  });
});
