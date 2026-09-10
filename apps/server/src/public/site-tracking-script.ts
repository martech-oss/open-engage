export function siteTrackingScript(trackingEndpoint: string, messagesEndpoint: string): string {
  return `(() => {
  if (window.openengage) return;
  const endpoint = ${JSON.stringify(trackingEndpoint)};
  const messagesEndpoint = ${JSON.stringify(messagesEndpoint)};
  const settings = window.openengageSettings ||= {};
  let identityGeneration = 0;
  let consentGeneration = 0;
  const visitorKey = "openengage_visitor_" + endpoint.split("/").pop();
  let identityToken = typeof settings.identityToken === "string" ? settings.identityToken : undefined;
  let identified = false;
  let visitorToken;
  function restoreVisitor() {
    if (settings.consent !== true || visitorToken) return;
    try { visitorToken = localStorage.getItem(visitorKey) || undefined; } catch {}
  }
  restoreVisitor();
  function acceptIdentity(token) {
    if (settings.consent !== true || typeof token !== "string") return;
    identityGeneration += 1;
    identified = false;
    visitorToken = token;
    stampRedirectLinks();
    try { localStorage.setItem(visitorKey, token); } catch {}
    window.dispatchEvent(new CustomEvent("openengage:identity", { detail: { visitorToken: token, consent: true } }));
    // Form tokens and verified tracking responses both change message eligibility.
    void loadMessage();
  }
  let recording = Promise.resolve();
  function record(type, resourceId, properties = {}) {
    if (settings.consent !== true) return Promise.resolve(null);
    const generation = consentGeneration;
    const next = recording.then(() => generation === consentGeneration ? recordNow(type, resourceId, properties) : null);
    recording = next.catch(() => null);
    return next;
  }

  async function recordNow(type, resourceId, properties = {}) {
    if (settings.consent !== true) return null;
    const generation = identityGeneration;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consent: true,
          visitorToken,
          identityToken,
          type,
          resourceId,
          properties,
        }),
        keepalive: true,
      });
      const payload = await response.json();
      if (payload?.data?.visitorToken && generation === identityGeneration && settings.consent === true) {
        acceptIdentity(payload.data.visitorToken);
        identified = payload.data.identified === true;
        identityToken = undefined;
      }
      return payload?.data || null;
    } catch {
      return null;
    }
  }

  const shownMessages = new Set();
  let activeMessage;
  async function loadMessage() {
    const generation = identityGeneration;
    const pageUrl = window.location.href;
    const authenticated = settings.consent === true && Boolean(visitorToken);
    try {
      const url = new URL(messagesEndpoint);
      if (authenticated) {
        url.searchParams.set("visitorToken", visitorToken);
        url.searchParams.set("consent", "true");
      }
      url.searchParams.set("url", pageUrl);
      const response = await fetch(url);
      const payload = await response.json();
      if (!document.body) {
        await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
      }
      const message = payload?.data?.[0];
      if (!message || pageUrl !== window.location.href) return;
      if (message.audience !== "all" && (!authenticated || settings.consent !== true || generation !== identityGeneration)) return;
      if (authenticated && settings.consent === true && generation === identityGeneration) {
        identified = message.identified === true;
      }
      // Revalidate measurement even when the current CTA does not need to render again.
      if (activeMessage) return;
      const key = "openengage_message_" + message.id;
      const memoryKey = message.frequency === "page" ? key + ":" + pageUrl : key;
      if (shownMessages.has(memoryKey)) return;
      if (settings.consent === true && message.frequency !== "page") {
        try { if (sessionStorage.getItem(key)) return; } catch {}
      }

      const container = document.createElement("aside");
      container.setAttribute("role", "status");
      container.style.cssText =
        "position:fixed;right:20px;bottom:20px;max-width:360px;padding:20px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;color:#111827;box-shadow:0 18px 48px rgba(0,0,0,.18);font:14px/1.5 system-ui,sans-serif;z-index:2147483647";
      const close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "メッセージを閉じる");
      close.textContent = "×";
      close.style.cssText =
        "position:absolute;right:10px;top:8px;border:0;background:transparent;font-size:22px;cursor:pointer;color:#6b7280";
      close.addEventListener("click", () => {
        container.remove();
        if (activeMessage?.container === container) activeMessage = undefined;
      });
      const title = document.createElement("strong");
      title.textContent = message.headline;
      title.style.cssText = "display:block;padding-right:22px;font-size:16px";
      const body = document.createElement("p");
      body.textContent = message.body;
      body.style.cssText = "margin:8px 0 0;color:#4b5563";
      container.append(close, title);
      if (message.body) container.append(body);
      if (message.cta_url && message.cta_label) {
        const link = document.createElement("a");
        link.href = message.cta_url;
        link.textContent = message.cta_label;
        link.rel = "noopener noreferrer";
        link.style.cssText =
          "display:inline-block;margin-top:14px;padding:8px 12px;border-radius:8px;background:#111827;color:#fff;text-decoration:none;font-weight:600";
        link.addEventListener("click", () => {
          void messageEvent(message.id, "click");
        });
        container.append(link);
      }
      document.body.append(container);
      activeMessage = { container, audience: message.audience };
      shownMessages.add(memoryKey);
      if (settings.consent === true && message.frequency !== "page") {
        try { sessionStorage.setItem(key, "shown"); } catch {}
      }
      void messageEvent(message.id, "impression");
    } catch {
      // Tracking must never interrupt the host page.
    }
  }

  function messageEvent(messageId, type) {
    if (settings.consent !== true || !visitorToken || !identified) return Promise.resolve();
    return fetch(messagesEndpoint + "/" + encodeURIComponent(messageId) + "/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorToken, type, consent: settings.consent === true }),
      keepalive: true,
    }).catch(() => null);
  }

  async function page() {
    // Public CTA must load even when tracking is refused, blocked or never resolves.
    void loadMessage();
    await record("page_viewed", window.location.href, {
      title: document.title,
      referrer: document.referrer,
    });
    stampRedirectLinks();
  }

  // Custom Redirect URLs are shareable and carry no per-recipient token, so the
  // only way a click made from this page can name the visitor is if we stamp
  // the id we already hold onto the link before they follow it.
  function stampRedirectLinks() {
    const origin = new URL(endpoint).origin;
    for (const anchor of document.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== origin || !url.pathname.startsWith("/r/")) continue;
        if (settings.consent === true && visitorToken) { url.searchParams.set("oe_v", visitorToken); url.searchParams.set("consent", "true"); }
        else { url.searchParams.delete("oe_v"); url.searchParams.delete("consent"); }
        anchor.href = url.toString();
      } catch {}
    }
  }

  document.addEventListener("click", stampRedirectLinks, true);

  window.openengage = {
    consent(value = true) {
      consentGeneration += 1;
      identityGeneration += 1;
      settings.consent = value === true;
      if (settings.consent) { restoreVisitor(); void page(); }
      else {
        visitorToken = undefined; identityToken = undefined; identified = false;
        if (activeMessage && activeMessage.audience !== "all") {
          activeMessage.container.remove(); activeMessage = undefined;
        }
        try { localStorage.removeItem(visitorKey); } catch {}
        stampRedirectLinks();
        window.dispatchEvent(new CustomEvent("openengage:identity", { detail: { consent: false } }));
        void loadMessage();
      }
    },
    acceptIdentity,
    identify(value) {
      identityGeneration += 1;
      identityToken = value;
      return page();
    },
    track(name, properties) {
      return record("custom_event", name, properties);
    },
  };

  void page();
})();`;
}
