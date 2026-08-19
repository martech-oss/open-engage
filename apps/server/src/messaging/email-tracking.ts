import { createSignedToken, isRedirectableUrl } from "../platform/crypto";

/**
 * Open/click measurement runs on the *rendered* HTML rather than on the
 * EmailDocument, because Markdown blocks produce links that never exist as a
 * `href` field on any block. Post-processing is the only place every link is
 * visible at once. It lives here rather than in `../rendering` so the render
 * layer stays free of signing and environment concerns.
 */
export interface EmailTrackingContext {
  secret: string;
  appUrl: string;
  workspaceId: string;
  deliveryId: string;
  contactId: string;
  openTracking: boolean;
  clickTracking: boolean;
}

/** Matches the reply-address window in ./reply-address, doubled: links outlive replies. */
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Paths we must never route through the click redirect. Rewriting the
 * unsubscribe or preference link would make opting out depend on the tracking
 * endpoint, and the asset paths are our own images, not destinations.
 */
const EXCLUDED_PATH_PREFIXES = ["/u/", "/preference/", "/a/", "/api/email-images/", "/t/", "/c/"];

const HREF_PATTERN = /href="([^"]*)"/g;

export async function applyEmailTracking(
  html: string,
  context: EmailTrackingContext,
): Promise<string> {
  let result = html;
  if (context.clickTracking) result = await rewriteLinks(result, context);
  if (context.openTracking) result = await injectOpenPixel(result, context);
  return result;
}

async function rewriteLinks(html: string, context: EmailTrackingContext): Promise<string> {
  const origin = safeOrigin(context.appUrl);
  const targets = new Set<string>();
  for (const match of html.matchAll(HREF_PATTERN)) {
    const target = decodeAttribute(match[1] ?? "");
    if (isTrackableLink(target, origin)) targets.add(target);
  }
  if (targets.size === 0) return html;

  const rewritten = new Map<string, string>();
  for (const target of targets) {
    rewritten.set(target, await buildClickUrl(target, context));
  }
  return html.replaceAll(HREF_PATTERN, (match, raw: string) => {
    const replacement = rewritten.get(decodeAttribute(raw));
    return replacement ? `href="${encodeAttribute(replacement)}"` : match;
  });
}

async function injectOpenPixel(html: string, context: EmailTrackingContext): Promise<string> {
  const token = await createSignedToken(context.secret, {
    workspaceId: context.workspaceId,
    resourceId: context.deliveryId,
    contactId: context.contactId,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    purpose: "tracking",
  });
  const pixel =
    `<img src="${encodeAttribute(`${trimTrailingSlash(context.appUrl)}/t/${token}`)}" ` +
    `width="1" height="1" alt="" style="display:none;border:0" />`;
  const index = html.lastIndexOf("</body>");
  return index === -1 ? `${html}${pixel}` : `${html.slice(0, index)}${pixel}${html.slice(index)}`;
}

async function buildClickUrl(target: string, context: EmailTrackingContext): Promise<string> {
  const token = await createSignedToken(context.secret, {
    workspaceId: context.workspaceId,
    resourceId: context.deliveryId,
    contactId: context.contactId,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    purpose: "click",
    url: target,
  });
  return `${trimTrailingSlash(context.appUrl)}/c/${token}`;
}

function isTrackableLink(target: string, origin: string | null): boolean {
  // Leaves mailto:, tel:, "#anchor", relative paths and merge-tag leftovers alone.
  if (!isRedirectableUrl(target)) return false;
  const url = new URL(target);
  if (origin && url.origin === origin) {
    return !EXCLUDED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  }
  return true;
}

function safeOrigin(appUrl: string): string | null {
  try {
    return new URL(appUrl).origin;
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

/**
 * React Email escapes `&` inside attributes, so a query string arrives here as
 * `a=1&amp;b=2`. Signing that verbatim would redirect visitors to a URL with a
 * literal `&amp;` in it, so decode on the way in and re-encode on the way out.
 */
function decodeAttribute(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

function encodeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
