import { isRecord } from "../platform/values";
import { escapeHtml } from "./html";

export function siteTrackingScript(trackingEndpoint: string, messagesEndpoint: string): string {
  return `(() => {
  if (window.openengage) return;
  const endpoint = ${JSON.stringify(trackingEndpoint)};
  const messagesEndpoint = ${JSON.stringify(messagesEndpoint)};
  const settings = window.openengageSettings || {};
  const visitorKey = "openengage_visitor_" + endpoint.split("/").pop();
  let email = typeof settings.email === "string" ? settings.email : undefined;
  let visitorId = localStorage.getItem(visitorKey) || undefined;

  async function record(type, resourceId, properties = {}) {
    if (settings.consent !== true) return null;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consent: true,
          visitorId,
          email,
          type,
          resourceId,
          properties,
        }),
        keepalive: true,
      });
      const payload = await response.json();
      if (payload?.data?.visitorId) {
        visitorId = payload.data.visitorId;
        localStorage.setItem(visitorKey, visitorId);
      }
      return payload?.data || null;
    } catch {
      return null;
    }
  }

  async function loadMessage() {
    if (!visitorId) return;
    try {
      const url = new URL(messagesEndpoint);
      url.searchParams.set("visitorId", visitorId);
      url.searchParams.set("url", window.location.href);
      const response = await fetch(url);
      const payload = await response.json();
      const message = payload?.data?.[0];
      if (!message || sessionStorage.getItem("openengage_message_" + message.id)) return;
      sessionStorage.setItem("openengage_message_" + message.id, "shown");

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
      close.addEventListener("click", () => container.remove());
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
      void messageEvent(message.id, "impression");
    } catch {
      // Tracking must never interrupt the host page.
    }
  }

  function messageEvent(messageId, type) {
    return fetch(messagesEndpoint + "/" + encodeURIComponent(messageId) + "/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId, type }),
      keepalive: true,
    });
  }

  async function page() {
    const result = await record("page_viewed", window.location.href, {
      title: document.title,
      referrer: document.referrer,
    });
    stampRedirectLinks();
    if (result?.identified) await loadMessage();
  }

  // Custom Redirect URLs are shareable and carry no per-recipient token, so the
  // only way a click made from this page can name the visitor is if we stamp
  // the id we already hold onto the link before they follow it.
  function stampRedirectLinks() {
    if (!visitorId) return;
    const origin = new URL(endpoint).origin;
    for (const anchor of document.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== origin || !url.pathname.startsWith("/r/")) continue;
        if (url.searchParams.get("oe_v") === visitorId) continue;
        url.searchParams.set("oe_v", visitorId);
        anchor.href = url.toString();
      } catch {}
    }
  }

  window.openengage = {
    consent() {
      settings.consent = true;
      void page();
    },
    identify(value) {
      email = value;
      void page();
    },
    track(name, properties) {
      return record("custom_event", name, properties);
    },
  };

  if (settings.consent === true) void page();
})();`;
}

export interface PublicFormRenderOptions {
  /** Field keys the identified visitor has already answered, for Progressive Profiling. */
  answered?: ReadonlySet<string>;
  /** Visitor transport used to derive the same Progressive Profiling view on POST. */
  visitorId?: string;
  /** Public key for the Cloudflare Turnstile widget when protection is enabled. */
  turnstileSiteKey?: string;
}

export interface RenderableField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  kind: "standard" | "custom";
}

const STANDARD_FIELDS = new Map<string, { label: string; type: string; required: boolean }>([
  ["email", { label: "メールアドレス", type: "email", required: true }],
  ["firstName", { label: "名", type: "text", required: false }],
  ["lastName", { label: "姓", type: "text", required: false }],
  ["phone", { label: "電話番号", type: "tel", required: false }],
]);

const INPUT_TYPES = new Set(["email", "text", "tel", "url", "number", "date"]);

export function renderPublicForm(
  name: string,
  definition: Record<string, unknown>,
  actionUrl: string,
  options: PublicFormRenderOptions = {},
): string {
  const fields = selectPublicFormFields(definition, options.answered ?? new Set());
  const controls = fields.map(renderControl).join("");
  const visitorTransport = options.visitorId
    ? `<input type="hidden" name="oe_v" value="${escapeHtml(options.visitorId)}">`
    : "";
  const turnstile = options.turnstileSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(options.turnstileSiteKey)}"></div>`
    : "";
  const turnstileScript = options.turnstileSiteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : "";
  const endpoint = escapeHtml(actionUrl.split("?")[0] ?? actionUrl);
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(name)}</title>
  <style>
    :root{color-scheme:light;font-family:system-ui,sans-serif;color:#111827}
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#fff}
    form{display:grid;gap:16px;max-width:520px;margin:auto}
    h1{margin:0;font-size:24px}label{display:grid;gap:6px;font-size:14px;font-weight:600}
    input,select{width:100%;height:42px;border:1px solid #d1d5db;border-radius:8px;padding:0 12px;font:inherit}
    textarea{width:100%;border:1px solid #d1d5db;border-radius:8px;padding:10px 12px;font:inherit}
    button{height:42px;border:0;border-radius:8px;background:#111827;color:#fff;font:inherit;font-weight:700;cursor:pointer}
    p{margin:0;color:#4b5563;font-size:14px}.hidden{position:absolute;left:-9999px}
  </style>
</head>
<body>
  <form id="signup-form">
    <h1>${escapeHtml(name)}</h1>
    ${controls}
    ${visitorTransport}
    <label class="hidden" aria-hidden="true">Website<input name="_website" tabindex="-1" autocomplete="off"></label>
    ${turnstile}
    <button type="submit">送信する</button>
    <p id="result" role="status"></p>
  </form>
  <script>
    document.getElementById("signup-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const result = document.getElementById("result");
      button.disabled = true;
      result.textContent = "送信しています…";
      try {
        const payload = Object.fromEntries(new FormData(form));
        payload.idempotencyKey = crypto.randomUUID();
        const response = await fetch("${endpoint}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message || "送信できませんでした");
        result.textContent = body?.data?.message || "ありがとうございます。";
        form.reset();
      } catch (error) {
        result.textContent = error instanceof Error ? error.message : "送信できませんでした";
      } finally {
        button.disabled = false;
      }
    });
  </script>
  ${turnstileScript}
</body>
</html>`;
}

/**
 * Picks the fields this visit should show. Non-progressive fields always
 * render; progressive ones drop out once answered, and only a few of the
 * remaining ones are asked at a time so the form stays short.
 */
export function selectPublicFormFields(
  definition: Record<string, unknown>,
  answered: ReadonlySet<string>,
): RenderableField[] {
  const configured = Array.isArray(definition["fields"])
    ? definition["fields"].filter(isRecord)
    : [];
  const maxProgressive = Math.max(1, Math.trunc(Number(definition["progressiveMaxFields"]) || 3));

  const always: RenderableField[] = [];
  const progressive: RenderableField[] = [];
  for (const raw of configured) {
    const field = toRenderableField(raw);
    if (!field) continue;
    if (raw["progressive"] === true) {
      // Email is the identity key, so it is asked every time regardless.
      if (field.key !== "email" && answered.has(field.key)) continue;
      progressive.push(field);
      continue;
    }
    always.push(field);
  }

  const fields = [...always, ...progressive.slice(0, maxProgressive)];
  if (!fields.some((field) => field.kind === "standard" && field.key === "email")) {
    fields.unshift({
      key: "email",
      label: "メールアドレス",
      type: "email",
      required: true,
      options: [],
      kind: "standard",
    });
  }
  return fields;
}

function toRenderableField(raw: Record<string, unknown>): RenderableField | null {
  const key = typeof raw["key"] === "string" ? raw["key"].trim() : "";
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) return null;
  const kind = raw["kind"] === "custom" ? "custom" : "standard";
  const label =
    typeof raw["label"] === "string" && raw["label"].trim() ? raw["label"].trim() : null;

  if (kind === "standard") {
    const base = STANDARD_FIELDS.get(key);
    if (!base) return null;
    return {
      key,
      label: label ?? base.label,
      type: base.type,
      required: key === "email" || raw["required"] === true,
      options: [],
      kind,
    };
  }

  const type = typeof raw["type"] === "string" ? raw["type"] : "text";
  return {
    key,
    label: label ?? key,
    type: INPUT_TYPES.has(type) || type === "textarea" || type === "select" ? type : "text",
    required: raw["required"] === true,
    options: Array.isArray(raw["options"])
      ? raw["options"].filter((option): option is string => typeof option === "string")
      : [],
    kind,
  };
}

function renderControl(field: RenderableField): string {
  const name = escapeHtml(field.kind === "custom" ? `custom:${field.key}` : field.key);
  const required = field.required ? " required" : "";
  if (field.type === "textarea") {
    return `<label>${escapeHtml(field.label)}<textarea name="${name}" rows="4"${required}></textarea></label>`;
  }
  if (field.type === "select") {
    const options = [
      `<option value="">選択してください</option>`,
      ...field.options.map(
        (option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`,
      ),
    ].join("");
    return `<label>${escapeHtml(field.label)}<select name="${name}"${required}>${options}</select></label>`;
  }
  return `<label>${escapeHtml(field.label)}<input name="${name}" type="${escapeHtml(field.type)}"${required}></label>`;
}

export function formEmbedScript(
  formUrl: string,
  formName: string,
  style: string,
  workspaceSlug: string,
): string {
  return `(() => {
  const current = document.currentScript;
  const frame = document.createElement("iframe");
  // Same localStorage key the tracking beacon writes. Passing it through lets
  // the form drop questions this visitor has already answered.
  const visitorId = localStorage.getItem("openengage_visitor_" + ${JSON.stringify(workspaceSlug)});
  frame.src = ${JSON.stringify(formUrl)} + (visitorId ? "?oe_v=" + encodeURIComponent(visitorId) : "");
  frame.title = ${JSON.stringify(formName)};
  frame.loading = "lazy";
  frame.style.cssText = "border:0;background:#fff;width:100%";
  const style = ${JSON.stringify(style)};

  if (style === "inline") {
    frame.style.height = "520px";
    current?.parentNode?.insertBefore(frame, current.nextSibling);
    return;
  }

  if (style === "floating-bar") {
    frame.style.cssText += ";position:fixed;left:0;bottom:0;height:230px;box-shadow:0 -10px 32px rgba(0,0,0,.14);z-index:2147483646";
    document.body.append(frame);
    return;
  }

  if (style === "floating-box") {
    frame.style.cssText += ";position:fixed;right:20px;bottom:20px;width:min(380px,calc(100vw - 40px));height:480px;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.18);z-index:2147483646";
    document.body.append(frame);
    return;
  }

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", ${JSON.stringify(formName)});
  overlay.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.45);z-index:2147483646";
  frame.style.cssText += ";max-width:560px;height:540px;border-radius:14px";
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "フォームを閉じる");
  close.textContent = "×";
  close.style.cssText = "position:absolute;right:24px;top:16px;border:0;background:transparent;color:#fff;font-size:32px;cursor:pointer";
  close.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.append(frame, close);
  document.body.append(overlay);
})();`;
}
