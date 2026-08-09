import * as z from "zod";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const templateTokenPattern = /\{\{\s*(contact|workspace|message)\.[A-Za-z0-9_.-]{1,191}\s*\}\}/g;

function isSafeEmailHref(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  const normalized = value.replaceAll(templateTokenPattern, "value");
  if (normalized.startsWith("mailto:")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.slice("mailto:".length));
  }
  try {
    return new URL(normalized).protocol === "https:";
  } catch {
    return false;
  }
}

export const emailHrefSchema = z.string().trim().min(1).max(2_000).refine(isSafeEmailHref, {
  message: "メール内リンクはhttps、mailto、または許可されたテンプレート変数にしてください",
});

const markdownSchema = z
  .string()
  .max(100_000)
  .refine((value) => !/<\/?[A-Za-z][^>]*>/.test(value), {
    message: "Markdown本文にHTMLは使用できません",
  })
  .superRefine((value, context) => {
    for (const match of value.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1];
      if (href && !isSafeEmailHref(href)) {
        context.addIssue({
          code: "custom",
          message: `安全でないMarkdownリンクです: ${href}`,
        });
      }
    }
  });

export const emailFontFamilySchema = z.enum(["sans", "serif", "mono"]);
export type EmailFontFamily = z.infer<typeof emailFontFamilySchema>;

export const emailThemeSchema = z.object({
  backgroundColor: colorSchema.default("#f4f5f7"),
  surfaceColor: colorSchema.default("#ffffff"),
  textColor: colorSchema.default("#171717"),
  mutedTextColor: colorSchema.default("#64748b"),
  accentColor: colorSchema.default("#171717"),
  fontFamily: emailFontFamilySchema.default("sans"),
  width: z.number().int().min(320).max(720).default(600),
});
export type EmailTheme = z.infer<typeof emailThemeSchema>;

const assetImageSourceSchema = z.object({
  kind: z.literal("asset"),
  assetId: z.string().min(1).max(191),
});

const emailLeafBlockOptions = [
  z.object({
    id: z.string().min(1).max(191),
    type: z.literal("markdown"),
    markdown: markdownSchema,
  }),
  z.object({
    id: z.string().min(1).max(191),
    type: z.literal("image"),
    source: assetImageSourceSchema,
    alt: z.string().max(500),
    href: emailHrefSchema.optional(),
    width: z.number().int().min(40).max(720).default(552),
    align: z.enum(["left", "center", "right"]).default("center"),
  }),
  z.object({
    id: z.string().min(1).max(191),
    type: z.literal("button"),
    label: z.string().trim().min(1).max(200),
    href: emailHrefSchema,
    variant: z.enum(["primary", "secondary"]).default("primary"),
    align: z.enum(["left", "center", "right"]).default("center"),
  }),
  z.object({ id: z.string().min(1).max(191), type: z.literal("divider") }),
  z.object({
    id: z.string().min(1).max(191),
    type: z.literal("spacer"),
    height: z.number().int().min(4).max(200),
  }),
] as const;

export const emailLeafBlockSchema = z.discriminatedUnion("type", emailLeafBlockOptions);
export type EmailLeafBlockV2 = z.infer<typeof emailLeafBlockSchema>;

export const emailBlockV2Schema = z.discriminatedUnion("type", [
  ...emailLeafBlockOptions,
  z.object({
    id: z.string().min(1).max(191),
    type: z.literal("columns"),
    columns: z.array(z.object({ blocks: z.array(emailLeafBlockSchema).max(20) })).length(2),
  }),
  z.object({
    id: z.string().min(1).max(191),
    type: z.literal("conditional"),
    field: z.string().trim().min(1).max(191),
    equals: z.union([z.string(), z.number(), z.boolean()]),
    blocks: z.array(emailLeafBlockSchema).max(50),
  }),
] as const);
export type EmailBlockV2 = z.infer<typeof emailBlockV2Schema>;

export const emailDocumentV2Schema = z.object({
  schemaVersion: z.literal(2),
  previewText: z.string().trim().max(200).default(""),
  theme: emailThemeSchema,
  blocks: z.array(emailBlockV2Schema).min(1).max(200),
});
export type EmailDocumentV2 = z.infer<typeof emailDocumentV2Schema>;

export function defaultEmailDocumentV2(): EmailDocumentV2 {
  return emailDocumentV2Schema.parse({
    schemaVersion: 2,
    previewText: "",
    theme: {},
    blocks: [{ id: "body", type: "markdown", markdown: "本文を入力してください。" }],
  });
}
