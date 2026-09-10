import { describe, expect, it } from "vitest";

import { siteTrackingScript } from "./templates";

function browser(
  options: {
    consent?: boolean;
    loadingDocument?: boolean;
    blockedStorage?: boolean;
    session?: Map<string, string>;
    visitorToken?: string;
  } = {},
) {
  const storage = new Map<string, string>();
  if (options.visitorToken) storage.set("openengage_visitor_acme", options.visitorToken);
  const pending: Array<(value: unknown) => void> = [];
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const messages: Array<(value: unknown) => void> = [];
  const session = options.session ?? new Map<string, string>();
  const storageAccess: string[] = [];
  const identityStorageAccess: string[] = [];
  class Element {
    children: Element[] = [];
    style = { cssText: "" };
    textContent = "";
    href = "";
    removed = false;
    listeners = new Map<string, () => void>();
    constructor(public tag: string) {}
    append(...children: Element[]) {
      this.children.push(...children);
    }
    setAttribute() {}
    addEventListener(name: string, listener: () => void) {
      this.listeners.set(name, listener);
    }
    remove() {
      this.removed = true;
    }
  }
  const body = new Element("body");
  const anchors = [{ href: "https://app.example/r/acme/link" }];
  const documentListeners = new Map<string, () => void>();
  const document = {
    body: options.loadingDocument ? null : body,
    createElement: (tag: string) => new Element(tag),
    title: "Page",
    referrer: "",
    querySelectorAll: () => anchors,
    addEventListener: (name: string, listener: () => void) => documentListeners.set(name, listener),
  };
  const window: Record<string, any> = {
    openengageSettings: { consent: options.consent },
    location: { href: "https://example.com" },
    dispatchEvent: () => {},
  };
  const localStorage = {
    getItem: (key: string) => {
      identityStorageAccess.push("read");
      if (options.blockedStorage) throw new Error("denied");
      return storage.get(key);
    },
    setItem: (key: string, value: string) => {
      if (options.blockedStorage) throw new Error("denied");
      return storage.set(key, value);
    },
    removeItem: (key: string) => storage.delete(key),
  };
  const sessionStorage = {
    getItem(key: string) {
      storageAccess.push("read");
      if (options.blockedStorage) throw new Error("denied");
      return session.get(key);
    },
    setItem(key: string, value: string) {
      storageAccess.push("write");
      if (options.blockedStorage) throw new Error("denied");
      session.set(key, value);
    },
  };
  const fetch = (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.pathname.endsWith("/events"))
      return Promise.resolve({ json: async () => ({ data: { accepted: true } }) });
    return new Promise((resolve) =>
      (url.pathname === "/messages" ? messages : pending).push(resolve),
    );
  };
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
    "sessionStorage",
    "fetch",
    "CustomEvent",
    siteTrackingScript("https://app.example/api/public/track/acme", "https://app.example/messages"),
  )(window, document, localStorage, sessionStorage, fetch, CustomEvent);
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const respond = async (token: string, identified = true) => {
    pending.shift()?.({ json: async () => ({ data: { visitorToken: token, identified } }) });
    await flush();
  };
  const respondMessage = async (data: unknown) => {
    messages.shift()?.({ json: async () => ({ data }) });
    await flush();
  };
  return {
    ready: async () => {
      document.body = body;
      documentListeners.get("DOMContentLoaded")?.();
      await flush();
    },
    window,
    storage,
    anchors,
    flush,
    respond,
    respondMessage,
    requests,
    body,
    storageAccess,
    identityStorageAccess,
    session,
  };
}

describe("browser identity changes", () => {
  it("revalidates a form token before measuring clicks on an already visible public CTA", async () => {
    const b = browser({ consent: true });
    await b.flush();
    await b.respondMessage([{ ...publicMessage, identified: false }]);
    await b.respond("anonymous-token", false);
    await b.respondMessage([{ ...publicMessage, identified: false }]);
    const link = b.body.children[0]!.children.find((element) => element.tag === "a")!;
    b.window.openengage.acceptIdentity("form-token");
    await b.flush();
    expect(
      b.requests
        .filter((r) => r.url.pathname === "/messages")
        .at(-1)!
        .url.searchParams.get("visitorToken"),
    ).toBe("form-token");
    link.listeners.get("click")!();
    expect(b.requests.filter((r) => r.url.pathname.endsWith("/events"))).toHaveLength(0);
    await b.respondMessage([{ ...publicMessage, identified: true }]);
    link.listeners.get("click")!();
    const events = b.requests.filter((r) => r.url.pathname.endsWith("/events"));
    expect(events).toHaveLength(1);
    expect(
      JSON.parse(typeof events[0]!.init?.body === "string" ? events[0]!.init.body : ""),
    ).toEqual({ visitorToken: "form-token", type: "click", consent: true });
    expect(b.body.children).toHaveLength(1);
  });

  it("loads an identified-only CTA after an embedded form binds the visitor", async () => {
    const b = browser({ consent: true });
    await b.flush();
    await b.respondMessage([]);
    await b.respond("anonymous-token", false);
    await b.respondMessage([]);
    b.window.openengage.acceptIdentity("form-token");
    await b.flush();
    await b.respondMessage([{ ...publicMessage, audience: "identified", identified: true }]);
    expect(b.body.children).toHaveLength(1);
    expect(b.requests.filter((r) => r.url.pathname.endsWith("/events"))).toHaveLength(1);
  });

  it("reloads messages when the initial queued page consumes a synchronous identify token", async () => {
    const b = browser({ consent: true });
    void b.window.openengage.identify("signed-contact");
    await b.flush();
    await b.respondMessage([]);
    await b.respondMessage([]);
    const beacon = b.requests.find((r) => r.url.pathname === "/api/public/track/acme")!;
    expect(
      JSON.parse(typeof beacon.init?.body === "string" ? beacon.init.body : "").identityToken,
    ).toBe("signed-contact");
    await b.respond("identified-first-token");
    expect(
      b.requests
        .filter((r) => r.url.pathname === "/messages")
        .at(-1)!
        .url.searchParams.get("visitorToken"),
    ).toBe("identified-first-token");
    await b.respondMessage([{ ...publicMessage, audience: "identified", identified: true }]);
    await b.respond("identified-next-token");
    await b.respondMessage([{ ...publicMessage, audience: "identified", identified: true }]);
    expect(b.body.children).toHaveLength(1);
    expect(b.requests.filter((r) => r.url.pathname.endsWith("/events"))).toHaveLength(1);
  });

  it("ignores an old form-identity response before measuring the current visitor", async () => {
    const b = browser({ consent: true, visitorToken: "saved-token" });
    await b.flush();
    await b.respondMessage([{ ...publicMessage, identified: true }]);
    const link = b.body.children[0]!.children.find((element) => element.tag === "a")!;
    b.window.openengage.acceptIdentity("older-form-token");
    b.window.openengage.acceptIdentity("current-form-token");
    await b.respondMessage([{ ...publicMessage, identified: true }]);
    link.listeners.get("click")!();
    expect(b.requests.filter((r) => r.url.pathname.endsWith("/events"))).toHaveLength(1);
    await b.respondMessage([{ ...publicMessage, identified: true }]);
    link.listeners.get("click")!();
    const events = b.requests.filter((r) => r.url.pathname.endsWith("/events"));
    expect(events).toHaveLength(2);
    expect(
      JSON.parse(typeof events[1]!.init?.body === "string" ? events[1]!.init.body : "")
        .visitorToken,
    ).toBe("current-form-token");
  });

  it("restores a saved visitor only after a delayed consent grant and clears it on withdrawal", async () => {
    const b = browser({ consent: false, visitorToken: "saved-token" });
    await b.flush();
    expect(b.identityStorageAccess).toEqual([]);
    expect(b.requests[0]!.url.searchParams.has("visitorToken")).toBe(false);
    await b.respondMessage([]);
    b.window.openengage.consent(true);
    await b.flush();
    expect(b.identityStorageAccess).toEqual(["read"]);
    const messageRequest = b.requests.filter((r) => r.url.pathname === "/messages").at(-1)!;
    expect(messageRequest.url.searchParams.get("visitorToken")).toBe("saved-token");
    const trackingRequest = b.requests.find((r) => r.url.pathname === "/api/public/track/acme")!;
    const trackingBody = trackingRequest.init?.body;
    expect(JSON.parse(typeof trackingBody === "string" ? trackingBody : "").visitorToken).toBe(
      "saved-token",
    );
    await b.respondMessage([{ ...publicMessage, audience: "identified", identified: true }]);
    expect(b.body.children).toHaveLength(1);
    b.window.openengage.consent(false);
    expect(b.storage.get("openengage_visitor_acme")).toBeUndefined();
    expect(b.body.children[0]!.removed).toBe(true);
    b.window.openengage.consent(true);
    const regrantRequest = b.requests.filter((r) => r.url.pathname === "/messages").at(-1)!;
    expect(regrantRequest.url.searchParams.has("visitorToken")).toBe(false);
  });

  it("drops queued events from withdrawn consent before a later grant", async () => {
    const b = browser({ consent: true });
    await b.flush();
    void b.window.openengage.track("old-custom", {});
    b.window.openengage.consent(false);
    b.window.openengage.consent(true);
    await b.respond("withdrawn-token");
    await b.flush();
    expect(
      b.requests
        .filter((r) => r.url.pathname === "/api/public/track/acme")
        .map((r) => JSON.parse(typeof r.init?.body === "string" ? r.init.body : "").type),
    ).toEqual(["page_viewed", "page_viewed"]);
  });

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

const publicMessage = {
  id: "public",
  headline: "Welcome",
  body: "Ask us",
  cta_url: "https://example.com/contact",
  cta_label: "Contact",
  audience: "all",
  frequency: "session",
};

describe("browser public CTA", () => {
  it("waits for the host body when an async head embed receives CTA before DOM ready", async () => {
    const b = browser({ loadingDocument: true });
    await b.flush();
    await b.respondMessage([publicMessage]);
    expect(b.body.children).toHaveLength(0);
    await b.ready();
    expect(b.body.children).toHaveLength(1);
  });

  it("reports identified impressions and clicks using a consented saved identity even when tracking hangs", async () => {
    const b = browser({ consent: true, visitorToken: "saved-token" });
    await b.flush();
    await b.respondMessage([{ ...publicMessage, identified: true }]);
    const link = b.body.children[0]!.children.find((e) => e.tag === "a")!;
    link.listeners.get("click")!();
    expect(
      b.requests
        .filter((r) => r.url.pathname.endsWith("/events"))
        .map((r) => JSON.parse(typeof r.init?.body === "string" ? r.init.body : "")),
    ).toEqual([
      { visitorToken: "saved-token", type: "impression", consent: true },
      { visitorToken: "saved-token", type: "click", consent: true },
    ]);
    b.window.openengage.consent(false);
    link.listeners.get("click")!();
    expect(b.requests.filter((r) => r.url.pathname.endsWith("/events"))).toHaveLength(2);
  });

  it("displays before consent without tracking, identity transport or session storage", async () => {
    const b = browser();
    await b.flush();
    expect(b.requests.map((r) => r.url.pathname)).toEqual(["/messages"]);
    expect(b.requests[0]!.url.searchParams.has("visitorToken")).toBe(false);
    await b.respondMessage([publicMessage]);
    expect(b.body.children).toHaveLength(1);
    const link = b.body.children[0]!.children.find((e) => e.tag === "a")!;
    expect(link.href).toBe("https://example.com/contact");
    link.listeners.get("click")!();
    expect(b.requests).toHaveLength(1);
    expect(b.storageAccess).toEqual([]);
    expect(b.storage.size).toBe(0);
  });

  it("does not wait for a tracking response and tolerates session storage refusal", async () => {
    const b = browser({ consent: true, blockedStorage: true });
    await b.flush();
    await b.respondMessage([publicMessage]);
    expect(b.body.children).toHaveLength(1);
    expect(b.requests.some((r) => r.url.pathname === "/api/public/track/acme")).toBe(true);
  });

  it("uses session suppression only for session frequency", async () => {
    const session = new Map([["openengage_message_public", "shown"]]);
    const b = browser({ consent: true, session });
    await b.flush();
    await b.respondMessage([publicMessage]);
    expect(b.body.children).toHaveLength(0);
    const page = browser({ consent: true, session });
    await page.flush();
    await page.respondMessage([{ ...publicMessage, frequency: "page" }]);
    expect(page.body.children).toHaveLength(1);
  });

  it("handles empty results and suppresses repeated results within a page", async () => {
    const b = browser();
    await b.flush();
    await b.respondMessage([]);
    expect(b.body.children).toHaveLength(0);
    b.window.openengage.consent(true);
    await b.flush();
    await b.respondMessage([publicMessage]);
    expect(b.body.children).toHaveLength(1);
    b.window.openengage.consent(true);
    await b.flush();
    await b.respondMessage([publicMessage]);
    expect(b.body.children).toHaveLength(1);
  });

  it("discards an identified response after consent revocation and never sends a later click event", async () => {
    const b = browser({ consent: true });
    await b.flush();
    await b.respondMessage([]);
    await b.respond("token");
    b.window.openengage.consent(false);
    await b.respondMessage([{ ...publicMessage, audience: "identified" }]);
    expect(b.body.children).toHaveLength(0);
    await b.respondMessage([publicMessage]);
    expect(b.body.children).toHaveLength(1);
    b.body.children[0]!.children.find((e) => e.tag === "a")!.listeners.get("click")!();
    expect(b.requests.filter((r) => r.url.pathname.endsWith("/events"))).toHaveLength(0);
  });
});
