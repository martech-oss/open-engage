import * as z from "zod";

export const emailBrandProfileSchema = z.object({
  brandName: z.string().trim().max(191),
  companyDescription: z.string().trim().max(2_000),
  tone: z.string().trim().max(1_000),
  logoAssetId: z.string().min(1).max(191).nullable(),
  websiteUrl: z
    .url()
    .refine((value) => value.startsWith("https://"), {
      message: "WebサイトURLはhttpsである必要があります",
    })
    .nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  postalAddress: z.string().trim().max(500),
  updatedAt: z.string().nullable(),
});
export type EmailBrandProfile = z.infer<typeof emailBrandProfileSchema>;

export const emailBrandProfileWriteSchema = emailBrandProfileSchema.omit({ updatedAt: true });
export type EmailBrandProfileWrite = z.infer<typeof emailBrandProfileWriteSchema>;
