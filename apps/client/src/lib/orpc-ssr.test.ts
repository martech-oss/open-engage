import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  bindingFetch: vi.fn<(request: Request) => Promise<Response>>(),
  browserFetch: vi.fn<(request: Request) => Promise<Response>>(),
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
  getRequestUrl: () => new URL("https://client.example.test/dashboard"),
}));

describe("SSR oRPC transport", () => {
  beforeEach(() => {
    testState.bindingFetch.mockReset();
    testState.browserFetch.mockReset();
    vi.stubGlobal("fetch", testState.browserFetch);
  });

  it("uses SERVER.fetch and forwards inbound cookies and headers", async () => {
    testState.bindingFetch.mockResolvedValue(
      new Response("{}", { status: 500, headers: { "content-type": "application/json" } }),
    );
    testState.browserFetch.mockResolvedValue(new Response("{}", { status: 500 }));

    const { orpc } = await import("./orpc");
    await orpc.dashboard.get().catch(() => undefined);

    expect(testState.browserFetch).not.toHaveBeenCalled();
    expect(testState.bindingFetch).toHaveBeenCalledOnce();
    const request = testState.bindingFetch.mock.calls[0]![0];
    expect(new URL(request.url).pathname).toBe("/api/rpc/dashboard/get");
    expect(request.headers.get("cookie")).toBe("session=ssr-cookie");
    expect(request.headers.get("x-request-id")).toBe("request-123");
  });
});
