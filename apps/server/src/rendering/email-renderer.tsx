import type { CSSProperties, ReactNode } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Markdown,
  Preview,
  Row,
  Section,
  Text,
  render,
  toPlainText,
} from "react-email";

import {
  emailHrefSchema,
  type EmailBlockV2,
  type EmailBrandProfile,
  type EmailDocumentV2,
  type EmailLeafBlockV2,
  type EmailPurpose,
  type EmailTemplateUpdate,
} from "@openengage/core/messaging";

import {
  interpolate,
  renderSubject,
  type RenderContext,
  type RenderedContent,
} from "./content-renderer";
import { readPath } from "./read-path";

export interface EmailRenderOptions {
  purpose: EmailPurpose;
  brand: EmailBrandProfile;
  assetUrls: Readonly<Record<string, string>>;
  unsubscribeUrl?: string;
  preferenceUrl?: string;
}

export async function renderEmailDocument(
  document: EmailDocumentV2,
  context: RenderContext,
  options: EmailRenderOptions,
): Promise<RenderedContent> {
  const html = await render(
    <ReactEmailDocument document={document} context={context} options={options} />,
  );
  return { html, text: toPlainText(html) };
}

const PREVIEW_CONTEXT: RenderContext = {
  contact: {
    email: "taro@example.com",
    first_name: "太郎",
    last_name: "山田",
    stage: "lead",
    score: 10,
  },
  workspace: { name: "OpenEngage Workspace" },
  message: { brand: "OpenEngage" },
};

export async function previewEmailTemplate(
  input: Pick<EmailTemplateUpdate, "subject" | "content"> & { purpose: EmailPurpose },
  options: Omit<EmailRenderOptions, "purpose">,
): Promise<RenderedContent & { subject: string }> {
  return {
    subject: renderSubject(input.subject, PREVIEW_CONTEXT),
    ...(await renderEmailDocument(input.content, PREVIEW_CONTEXT, {
      ...options,
      purpose: input.purpose,
      ...(input.purpose === "marketing"
        ? {
            unsubscribeUrl: "https://example.com/unsubscribe-preview",
            preferenceUrl: "https://example.com/preferences-preview",
          }
        : {}),
    })),
  };
}

function ReactEmailDocument({
  document,
  context,
  options,
}: {
  document: EmailDocumentV2;
  context: RenderContext;
  options: EmailRenderOptions;
}): ReactNode {
  const theme = document.theme;
  const fontFamily = fontStack(theme.fontFamily);
  const logoUrl = options.brand.logoAssetId
    ? options.assetUrls[options.brand.logoAssetId]
    : undefined;
  return (
    <Html lang="ja" dir="ltr">
      <Head />
      {document.previewText ? (
        <Preview>{interpolateMarkdown(document.previewText, context)}</Preview>
      ) : null}
      <Body style={{ margin: 0, backgroundColor: theme.backgroundColor, fontFamily }}>
        <Container
          style={{
            maxWidth: `${theme.width}px`,
            margin: "0 auto",
            backgroundColor: theme.surfaceColor,
            color: theme.textColor,
          }}
        >
          {logoUrl ? (
            <Section style={{ padding: "24px 24px 8px", textAlign: "left" }}>
              <Img src={logoUrl} alt={options.brand.brandName} height="40" />
            </Section>
          ) : null}
          {document.blocks.map((block) => (
            <EmailBlock
              key={block.id}
              block={block}
              document={document}
              context={context}
              options={options}
            />
          ))}
          <ManagedFooter document={document} context={context} options={options} />
        </Container>
      </Body>
    </Html>
  );
}

function EmailBlock({
  block,
  document,
  context,
  options,
}: {
  block: EmailBlockV2;
  document: EmailDocumentV2;
  context: RenderContext;
  options: EmailRenderOptions;
}): ReactNode {
  if (block.type === "columns") {
    return (
      <Row style={{ padding: "8px 16px" }}>
        {block.columns.map((column, index) => (
          <Column key={`${block.id}-${index}`} style={{ width: "50%", verticalAlign: "top" }}>
            {column.blocks.map((child) => (
              <EmailLeafBlock
                key={child.id}
                block={child}
                document={document}
                context={context}
                options={options}
              />
            ))}
          </Column>
        ))}
      </Row>
    );
  }
  if (block.type === "conditional") {
    if (String(readPath(context.contact, block.field)) !== String(block.equals)) return null;
    return block.blocks.map((child) => (
      <EmailLeafBlock
        key={child.id}
        block={child}
        document={document}
        context={context}
        options={options}
      />
    ));
  }
  return <EmailLeafBlock block={block} document={document} context={context} options={options} />;
}

function EmailLeafBlock({
  block,
  document,
  context,
  options,
}: {
  block: EmailLeafBlockV2;
  document: EmailDocumentV2;
  context: RenderContext;
  options: EmailRenderOptions;
}): ReactNode {
  const theme = document.theme;
  switch (block.type) {
    case "markdown":
      return (
        <Markdown
          markdownContainerStyles={{ padding: "8px 24px", color: theme.textColor }}
          markdownCustomStyles={{
            h1: headingStyle(theme.textColor, 30),
            h2: headingStyle(theme.textColor, 24),
            h3: headingStyle(theme.textColor, 20),
            p: { color: theme.textColor, fontSize: "16px", lineHeight: "26px" },
            link: { color: theme.accentColor },
          }}
        >
          {interpolateMarkdown(block.markdown, context)}
        </Markdown>
      );
    case "image": {
      const src = options.assetUrls[block.source.assetId];
      if (!src) return null;
      const image = (
        <Img
          src={src}
          alt={interpolate(block.alt, context, false)}
          width={String(block.width)}
          style={{ display: "block", maxWidth: "100%", height: "auto", border: 0 }}
        />
      );
      return (
        <Section style={{ padding: "8px 24px", textAlign: block.align }}>
          {block.href ? <Link href={renderHref(block.href, context)}>{image}</Link> : image}
        </Section>
      );
    }
    case "button": {
      const primary = block.variant === "primary";
      return (
        <Section style={{ padding: "16px 24px", textAlign: block.align }}>
          <Button
            href={renderHref(block.href, context)}
            style={{
              display: "inline-block",
              padding: "12px 20px",
              borderRadius: "6px",
              border: `1px solid ${theme.accentColor}`,
              backgroundColor: primary ? theme.accentColor : theme.surfaceColor,
              color: primary ? "#ffffff" : theme.accentColor,
              textDecoration: "none",
              fontSize: "16px",
              fontWeight: 600,
            }}
          >
            {interpolate(block.label, context, false)}
          </Button>
        </Section>
      );
    }
    case "divider":
      return <Hr style={{ margin: "12px 24px", borderColor: "#e2e8f0" }} />;
    case "spacer":
      return <Section aria-hidden="true" style={{ height: `${block.height}px` }} />;
  }
}

function ManagedFooter({
  document,
  context,
  options,
}: {
  document: EmailDocumentV2;
  context: RenderContext;
  options: EmailRenderOptions;
}): ReactNode {
  const links: ReactNode[] = [];
  if (options.preferenceUrl) {
    links.push(
      <Link key="preferences" href={options.preferenceUrl} style={footerLinkStyle(document)}>
        配信設定
      </Link>,
    );
  }
  if (options.unsubscribeUrl) {
    links.push(
      <Link key="unsubscribe" href={options.unsubscribeUrl} style={footerLinkStyle(document)}>
        配信停止
      </Link>,
    );
  }
  const details = [options.brand.brandName, options.brand.postalAddress]
    .filter(Boolean)
    .join(" · ");
  if (options.purpose !== "marketing" && links.length === 0 && !details) return null;
  return (
    <Section style={{ padding: "24px", textAlign: "center" }}>
      {details ? (
        <Text style={{ margin: "0 0 8px", color: document.theme.mutedTextColor, fontSize: "12px" }}>
          {interpolate(details, context, false)}
        </Text>
      ) : null}
      {links.length > 0 ? (
        <Text style={{ margin: 0, color: document.theme.mutedTextColor, fontSize: "12px" }}>
          {links.map((link, index) => (
            <span key={index}>
              {index > 0 ? " · " : null}
              {link}
            </span>
          ))}
        </Text>
      ) : null}
    </Section>
  );
}

function headingStyle(color: string, fontSize: number): CSSProperties {
  return { color, fontSize: `${fontSize}px`, lineHeight: 1.25, margin: "16px 0 8px" };
}

function footerLinkStyle(document: EmailDocumentV2): CSSProperties {
  return { color: document.theme.mutedTextColor, textDecoration: "underline" };
}

function fontStack(font: EmailDocumentV2["theme"]["fontFamily"]): string {
  switch (font) {
    case "serif":
      return "Georgia, 'Times New Roman', serif";
    case "mono":
      return "Menlo, Monaco, Consolas, monospace";
    case "sans":
      return "Arial, 'Helvetica Neue', sans-serif";
  }
}

function interpolateMarkdown(value: string, context: RenderContext): string {
  return value.replace(
    /\{\{\s*(contact|workspace|message)\.([A-Za-z0-9_.-]{1,191})\s*\}\}/g,
    (_match, namespace: "contact" | "workspace" | "message", path: string) => {
      const resolved = readPath(context[namespace] ?? {}, path);
      const rendered =
        typeof resolved === "string" ||
        typeof resolved === "number" ||
        typeof resolved === "boolean"
          ? String(resolved)
          : "";
      const encoded = rendered
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      return [
        "\\",
        "`",
        "*",
        "_",
        "{",
        "}",
        "[",
        "]",
        "(",
        ")",
        "#",
        "+",
        ".",
        "!",
        "|",
        "~",
        "-",
      ].reduce((current, character) => current.replaceAll(character, `\\${character}`), encoded);
    },
  );
}

function renderHref(value: string, context: RenderContext): string {
  const rendered = interpolate(value, context, false);
  return emailHrefSchema.parse(rendered);
}
