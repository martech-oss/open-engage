import { resolveFormFields, signupFormDefinitionSchema } from "@openengage/core/web";

import { escapeHtml } from "../rendering/html";

export { siteTrackingScript } from "./site-tracking-script";

export interface PublicFormRenderOptions {
  measurementToken?: string;
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
  const parsedDefinition = signupFormDefinitionSchema.parse(definition);
  const allDefinition = {
    ...parsedDefinition,
    fields: parsedDefinition.fields?.map((field) => ({
      ...field,
      progressive: false,
      visibleWhen: undefined,
      requiredWhen: undefined,
    })),
  };
  const fields = selectPublicFormFields(allDefinition, new Set());
  const controls = fields.map(renderControl).join("");
  const visitorTransport = options.visitorId
    ? `<input type="hidden" name="oe_v" value="${escapeHtml(options.visitorId)}"><input type="hidden" name="consent" value="true">`
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
    [hidden]{display:none!important}p{margin:0;color:#4b5563;font-size:14px}.hidden{position:absolute;left:-9999px}
  </style>
</head>
<body>
  <form id="signup-form">
    <h1>${escapeHtml(name)}</h1>
    ${controls}
    ${visitorTransport}
    ${options.measurementToken ? `<input type="hidden" name="measurementToken" value="${escapeHtml(options.measurementToken)}">` : ""}
    <label class="hidden" aria-hidden="true">Website<input name="_website" tabindex="-1" autocomplete="off"></label>
    ${turnstile}
    <button type="submit">送信する</button>
    <p id="result" role="status"></p>
  </form>
  <script>
    const signup = document.getElementById("signup-form");
    const definition = ${JSON.stringify(parsedDefinition).replaceAll("<", "\\u003c")};
    const resolveFields = ${resolveFormFields.toString()};
    let answered = new Set();
    let profileRequest = 0;
    let parentOrigin = null;
    function reconcileControls() {
      const values = Object.fromEntries([...signup.querySelectorAll("input,select,textarea")].map(input => [input.name.replace(/^custom:/, ""), input.value]));
      const visible = new Map(resolveFields(definition, values, answered).map(field => [field.key, field]));
      for (const input of signup.querySelectorAll("input,select,textarea")) {
        if (["_website", "oe_v", "consent", "cf-turnstile-response", "measurementToken"].includes(input.name)) continue;
        const key = input.name.replace(/^custom:/, "");
        const field = visible.get(key);
        const hidden = key !== "email" && !field;
        input.disabled = hidden;
        input.required = !hidden && (key === "email" || field?.required === true);
        input.closest("label").hidden = hidden;
      }
    }
    async function refreshProfile() {
      const request = ++profileRequest;
      answered = new Set(); reconcileControls();
      const email = signup.querySelector('[name="email"]')?.value;
      const token = signup.querySelector('[name="oe_v"]')?.value;
      const consent = signup.querySelector('[name="consent"]')?.value === "true";
      if (!email || !token || !consent) return;
      try {
        const response = await fetch("${endpoint}/fields", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,visitorToken:token,consent,measurementToken:signup.querySelector('[name="measurementToken"]')?.value})});
        if (!response.ok) return;
        const data = await response.json();
        if (request !== profileRequest) return;
        answered = new Set(data.data?.answered ?? []); reconcileControls();
      } catch {}
    }
    signup.addEventListener("input", event => { delete signup.dataset.submissionKey; if (event.target.name === "email") void refreshProfile(); else reconcileControls(); });
    reconcileControls();
    window.addEventListener("message", (event) => {
      if (window.parent === window || event.source !== window.parent || event.data?.type !== "openengage:identity") return;
      const sender = URL.parse(event.origin);
      if (!sender || !["http:", "https:"].includes(sender.protocol)) return;
      parentOrigin = sender.origin;
      for (const name of ["oe_v", "consent"]) signup.querySelector('input[name="' + name + '"]')?.remove();
      if (event.data.consent === true && typeof event.data.visitorToken === "string") {
        for (const [name, value] of [["oe_v", event.data.visitorToken], ["consent", "true"]]) {
          const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; signup.append(input);
        }
      }
      void refreshProfile();
    });
    signup.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const result = document.getElementById("result");
      button.disabled = true;
      result.textContent = "送信しています…";
      try {
        const payload = Object.fromEntries(new FormData(form));
        if (payload.consent === "true") payload.consent = true;
        form.dataset.submissionKey ||= crypto.randomUUID();
        payload.idempotencyKey = form.dataset.submissionKey;
        const response = await fetch("${endpoint}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message || "送信できませんでした");
        result.textContent = body?.data?.message || "ありがとうございます。";
        if (body?.data?.visitorToken) {
          const input = form.querySelector('input[name="oe_v"]');
          if (input) { input.value = body.data.visitorToken; input.defaultValue = body.data.visitorToken; }
          const targetOrigin = parentOrigin ?? (document.referrer ? new URL(document.referrer).origin : location.origin);
          window.parent.postMessage({ type: "openengage:form-identity", visitorToken: body.data.visitorToken }, targetOrigin);
        }
        delete form.dataset.submissionKey;
        form.reset();
        void refreshProfile();
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
  values: Record<string, unknown> = {},
): RenderableField[] {
  const parsed = signupFormDefinitionSchema.parse(definition);
  const fields = resolveFormFields(
    parsed,
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key.replace(/^custom:/, ""), value]),
    ),
    answered,
  )
    .map((field) => toRenderableField(field))
    .filter((field): field is RenderableField => field !== null);
  if (!fields.some((field) => field.kind === "standard" && field.key === "email"))
    fields.unshift({
      key: "email",
      label: "メールアドレス",
      type: "email",
      required: true,
      options: [],
      kind: "standard",
    });
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
  const visitorKey = "openengage_visitor_" + ${JSON.stringify(workspaceSlug)};
  let visitorToken;
  try { if (window.openengageSettings?.consent === true) visitorToken = localStorage.getItem(visitorKey); } catch {}
  const formOrigin = new URL(${JSON.stringify(formUrl)}).origin;
  frame.src = ${JSON.stringify(formUrl)} + (visitorToken ? "?consent=true&oe_v=" + encodeURIComponent(visitorToken) : "");
  window.addEventListener("openengage:identity", event => frame.contentWindow?.postMessage({ type: "openengage:identity", ...event.detail }, formOrigin));
  frame.addEventListener("load", () => {
    let token; try { token = localStorage.getItem(visitorKey); } catch {}
    frame.contentWindow?.postMessage({ type: "openengage:identity", visitorToken: token, consent: window.openengageSettings?.consent === true }, formOrigin);
  });
  window.addEventListener("message", event => {
    if (event.source !== frame.contentWindow || event.origin !== formOrigin || event.data?.type !== "openengage:form-identity") return;
    if (window.openengageSettings?.consent !== true || typeof event.data.visitorToken !== "string") return;
    try { localStorage.setItem(visitorKey, event.data.visitorToken); } catch {}
    window.openengage?.acceptIdentity(event.data.visitorToken);
  });
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
