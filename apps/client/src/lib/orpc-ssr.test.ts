import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  bindingFetch: vi.fn<(request: Request) => Promise<Response>>(),
  browserFetch: vi.fn<(request: Request) => Promise<Response>>(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    APP_URL: "https://app.example.test",
    SERVER: { fetch: testState.bindingFetch },
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () =>
    new Headers({
      accept: "application/json",
      "accept-language": "ja-JP",
      authorization: "Bearer must-not-forward",
      baggage: "sentry-release=boundary",
      cookie: "session=ssr-cookie",
      forwarded: "for=203.0.113.8",
      host: "attacker.example.test",
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      tracestate: "vendor=value",
      "x-forwarded-for": "203.0.113.8",
      "x-openengage-workspace": "must-not-forward",
      "x-request-id": "request-123",
    }),
  getRequestUrl: () => new URL("https://forwarded-attacker.example.test/dashboard"),
}));

describe("SSR oRPC transport", () => {
  beforeEach(() => {
    testState.bindingFetch.mockReset();
    testState.browserFetch.mockReset();
    vi.stubGlobal("fetch", testState.browserFetch);
  });

  it("uses SERVER.fetch with the strict SSR credential and tracing allowlist", async () => {
    testState.bindingFetch.mockResolvedValue(
      new Response("{}", { status: 500, headers: { "content-type": "application/json" } }),
    );
    testState.browserFetch.mockResolvedValue(new Response("{}", { status: 500 }));

    const { orpc } = await import("./orpc");
    await orpc.dashboard.get().catch(() => undefined);

    expect(testState.browserFetch).not.toHaveBeenCalled();
    expect(testState.bindingFetch).toHaveBeenCalledOnce();
    const request = testState.bindingFetch.mock.calls[0]![0];
    const requestUrl = new URL(request.url);
    expect(requestUrl.pathname).toBe("/api/rpc/dashboard/get");
    expect(requestUrl.origin).toBe("https://app.example.test");
    expect(request.headers.get("cookie")).toBe("session=ssr-cookie");
    expect(request.headers.get("accept-language")).toBe("ja-JP");
    expect(request.headers.get("traceparent")).toBe(
      "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    );
    expect(request.headers.get("tracestate")).toBe("vendor=value");
    expect(request.headers.get("baggage")).toBe("sentry-release=boundary");
    expect(request.headers.get("origin")).toBe("https://app.example.test");
    for (const name of [
      "authorization",
      "forwarded",
      "host",
      "x-forwarded-for",
      "x-openengage-workspace",
      "x-request-id",
    ]) {
      expect(request.headers.get(name)).toBeNull();
    }
  });
});
