import { describe, expect, it } from "vitest";

import { siteTrackingScript } from "./templates";

function browser() {
  const storage = new Map<string, string>();
  const pending: Array<(value: unknown) => void> = [];
  const anchors = [{ href: "https://app.example/r/acme/link" }];
  const document = {
    title: "Page",
    referrer: "",
    querySelectorAll: () => anchors,
    addEventListener: () => {},
  };
  const window: Record<string, any> = {
    location: { href: "https://example.com" },
    dispatchEvent: () => {},
  };
  const localStorage = {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const fetch = () => new Promise((resolve) => pending.push(resolve));
  const CustomEvent = class {
    constructor(
      public type: string,
      public detail: unknown,
    ) {}
  };
  // Execute only our generated tracking runtime against controlled browser fakes.
  // oxlint-disable-next-line typescript/no-implied-eval
  new Function(
    "window",
    "document",
    "localStorage",
    "fetch",
    "CustomEvent",
    siteTrackingScript("https://app.example/api/public/track/acme", "https://app.example/messages"),
  )(window, document, localStorage, fetch, CustomEvent);
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const respond = async (token: string) => {
    pending.shift()?.({ json: async () => ({ data: { visitorToken: token } }) });
    await flush();
  };
  return { window, storage, anchors, flush, respond };
}

describe("browser identity changes", () => {
  it("shares late consent with embeds and does not overwrite a form rotation with a stale beacon", async () => {
    const b = browser();
    b.window.openengage.consent(true);
    await b.flush();
    expect(b.window.openengageSettings?.consent).toBe(true);
    b.window.openengage.acceptIdentity("rotated-token");
    await b.respond("older-token");
    expect(b.storage.get("openengage_visitor_acme")).toBe("rotated-token");
    expect(new URL(b.anchors[0]!.href).searchParams.get("oe_v")).toBe("rotated-token");
  });

  it("invalidates outstanding identity responses across consent withdrawal and regrant", async () => {
    const b = browser();
    b.window.openengage.consent(true);
    await b.flush();
    b.window.openengage.consent(false);
    b.window.openengage.consent(true);
    await b.respond("withdrawn-token");
    expect(b.storage.get("openengage_visitor_acme")).toBeUndefined();
    await b.respond("new-token");
    expect(b.storage.get("openengage_visitor_acme")).toBe("new-token");
  });
});
