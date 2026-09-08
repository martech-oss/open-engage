import { generate, parse, walk } from "css-tree";
import rehypeParse from "rehype-parse";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

import {
  landingPageDocumentSchema,
  validateLandingVariablePlacement,
  type LandingPageDocument,
} from "@openengage/core/web";

const htmlSchema = {
  tagNames: [
    "main",
    "section",
    "article",
    "header",
    "footer",
    "nav",
    "aside",
    "div",
    "span",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "b",
    "i",
    "small",
    "br",
    "hr",
    "a",
    "img",
    "figure",
    "figcaption",
    "blockquote",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "details",
    "summary",
  ],
  attributes: {
    "*": [
      "id",
      "className",
      "role",
      "ariaLabel",
      "ariaLabelledBy",
      "ariaDescribedBy",
      "dataOeForm",
      "dataOeCta",
      "dataOeImage",
      "dataOeDynamic",
    ],
    a: ["href", "title"],
    img: ["alt", "width", "height"],
    th: ["scope"],
    td: ["colSpan", "rowSpan"],
  },
  protocols: { href: ["https", "http"] },
  clobberPrefix: "",
};

export async function sanitizeLandingHtml(
  html: string,
  managedReferences = false,
): Promise<string> {
  return String(
    await unified()
      .use(rehypeParse, { fragment: true })
      .use(
        rehypeSanitize,
        managedReferences
          ? htmlSchema
          : {
              ...htmlSchema,
              attributes: {
                ...htmlSchema.attributes,
                "*": htmlSchema.attributes["*"].filter((name) => !name.startsWith("dataOe")),
              },
            },
      )
      .use(rehypeStringify)
      .process(html),
  );
}

export async function sanitizeLandingDocument(
  input: LandingPageDocument,
): Promise<LandingPageDocument> {
  const document = landingPageDocumentSchema.parse(input);
  validateLandingVariablePlacement(document);
  const ast = parse(document.css, {
    positions: false,
    parseCustomProperty: true,
    onParseError: (error) => {
      throw error;
    },
  });
  walk(ast, (node) => {
    if (node.type === "Url" || node.type === "Raw")
      throw new Error("CSS URLs and unparsed CSS are not allowed");
    if (
      node.type === "Atrule" &&
      !["media", "supports", "keyframes", "layer", "container"].includes(node.name.toLowerCase())
    )
      throw new Error("CSS at-rule is not allowed");
    if (
      node.type === "Function" &&
      ["expression", "url", "image", "image-set", "-webkit-image-set"].includes(
        node.name.toLowerCase(),
      )
    )
      throw new Error("CSS function is not allowed");
    if (
      node.type === "Declaration" &&
      ["behavior", "-moz-binding"].includes(node.property.toLowerCase())
    )
      throw new Error("CSS property is not allowed");
  });
  const html = await sanitizeLandingHtml(document.html, true);
  const parsed = unified().use(rehypeParse, { fragment: true }).parse(html);
  const expected = new Map<string, string>([
    ...document.forms.map((item) => [item.refId, "dataOeForm"] as const),
    ...document.ctas.map((item) => [item.refId, "dataOeCta"] as const),
    ...document.images.map((item) => [item.refId, "dataOeImage"] as const),
    ...document.dynamicSlots.map((item) => [item.refId, "dataOeDynamic"] as const),
  ]);
  const seen = new Set<string>();
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if ("properties" in node && node.properties && typeof node.properties === "object") {
      for (const [key, value] of Object.entries(node.properties)) {
        if (!key.startsWith("dataOe")) continue;
        const id = String(value);
        if (expected.get(id) !== key || seen.has(id))
          throw new Error(`Invalid managed reference: ${id}`);
        seen.add(id);
      }
    }
    if ("children" in node && Array.isArray(node.children)) node.children.forEach(visit);
  }
  visit(parsed);
  if (seen.size !== expected.size) throw new Error("A managed reference is missing from the HTML");
  return {
    ...document,
    html,
    css: generate(ast),
    dynamicSlots: await Promise.all(
      document.dynamicSlots.map(async (slot) => ({
        ...slot,
        fallbackHtml: await sanitizeLandingHtml(slot.fallbackHtml),
      })),
    ),
  };
}
