import * as z from "zod";

import { emailBrandProfileSchema } from "../messaging/brand.js";
import { publicImageCatalogSchema } from "../messaging/generation.js";
import { variableKeySchema, variableTypeSchema } from "../projects/variables.js";
import { signupFormDefinitionSchema } from "../web/form-schema.js";
import { landingPageDocumentSchema } from "../web/landing-document.js";

/** Cross-domain trusted context for the Landing Page Designer. */
export const landingPageDesignerInitialDataSchema = z
  .object({
    variables: z.array(
      z.object({
        key: variableKeySchema,
        type: variableTypeSchema,
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
    ),
    variableProjectId: z.string().min(1).nullable(),
    brand: emailBrandProfileSchema,
    publicImages: publicImageCatalogSchema,
    forms: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string(),
          definition: signupFormDefinitionSchema,
          turnstileEnabled: z.boolean(),
          successMessage: z.string(),
        }),
      )
      .max(50),
    document: landingPageDocumentSchema,
    request: z.string().min(1),
    history: z.array(z.object({ prompt: z.string(), explanation: z.string().nullable() })).max(12),
  })
  .strict();
