import { siteTrackingScript } from "./templates";

export function browser(
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

export const publicMessage = {
  id: "public",
  headline: "Welcome",
  body: "Ask us",
  cta_url: "https://example.com/contact",
  cta_label: "Contact",
  audience: "all",
  frequency: "session",
};
