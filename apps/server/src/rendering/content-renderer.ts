import type { ContentDocument, EmailBlock } from "@openengage/core/web";

import { escapeHtml } from "../public/html";

export interface RenderContext {
  contact: Record<string, unknown>;
  workspace: Record<string, unknown>;
  message?: Record<string, unknown>;
}

export interface RenderedContent {
  html: string;
  text: string;
}

export function renderContent(document: ContentDocument, context: RenderContext): RenderedContent {
  const body = document.blocks
    .map((block) => renderBlock(block, context))
    .filter(Boolean)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:${document.backgroundColor}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="${document.width}" style="max-width:100%;background:${document.contentColor}" cellspacing="0" cellpadding="0"><tr><td>${body}</td></tr></table></td></tr></table></body></html>`;
  return { html, text: htmlToText(body) };
}

export function renderSubject(template: string, context: RenderContext): string {
  return interpolate(template, context, false)
    .replaceAll(/[\r\n]+/g, " ")
    .trim();
}

export function interpolate(template: string, context: RenderContext, escape = true): string {
  return template.replace(
    /\{\{\s*(contact|workspace|message)\.([A-Za-z0-9_.-]{1,191})\s*\}\}/g,
    (_match, namespace: "contact" | "workspace" | "message", path: string) => {
      const value = readPath(context[namespace] ?? {}, path);
      const rendered =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : "";
      return escape ? escapeHtml(rendered) : rendered;
    },
  );
}

function renderBlock(block: EmailBlock, context: RenderContext): string {
  switch (block.type) {
    case "text":
      return `<div style="padding:16px 24px">${sanitizeLimitedHtml(block.html, context)}</div>`;
    case "image": {
      const image = `<img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt)}" style="display:block;max-width:100%;height:auto;border:0">`;
      return `<div style="padding:8px 24px">${block.href ? `<a href="${escapeAttribute(block.href)}">${image}</a>` : image}</div>`;
    }
    case "button":
      return `<div style="padding:16px 24px;text-align:center"><a href="${escapeAttribute(interpolate(block.href, context, false))}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:${block.color};color:#fff;text-decoration:none">${escapeHtml(interpolate(block.label, context, false))}</a></div>`;
    case "divider":
      return '<div style="padding:12px 24px"><hr style="border:0;border-top:1px solid #e2e8f0"></div>';
    case "spacer":
      return `<div aria-hidden="true" style="height:${block.height}px;line-height:${block.height}px">&nbsp;</div>`;
    case "conditional":
      return String(readPath(context.contact, block.field)) === String(block.equals)
        ? block.blocks.map((child) => renderBlock(child, context)).join("")
        : "";
  }
}

function sanitizeLimitedHtml(value: string, context: RenderContext): string {
  return value
    .split(/(<[^>]*>)/g)
    .map((part) => {
      if (!part.startsWith("<")) return escapeHtml(interpolate(part, context, false));
      const allowed = part.match(/^<(\/?)(p|strong|b|em|i|u|s|ul|ol|li|h1|h2|h3|blockquote)>$/i);
      if (allowed) return `<${allowed[1] ?? ""}${allowed[2]?.toLowerCase()}>`;
      return /^<br\s*\/?>$/i.test(part) ? "<br>" : "";
    })
    .join("");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function htmlToText(html: string): string {
  return html
    .replaceAll(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)>/gi, "\n")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}
