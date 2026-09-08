import {
  resolveVariableRef,
  resolveVariableText,
  variableTextReferences,
  type VariableRef,
  type VariableSnapshot,
} from "../projects/variables";
import { signupFormDefinitionSchema, type SignupFormDefinition } from "./form-schema";
import { landingPageDocumentSchema, type LandingPageDocument } from "./landing-document";

export function resolveFormVariables(
  definition: SignupFormDefinition,
  successMessage: string,
  snapshot: VariableSnapshot,
) {
  return {
    definition: signupFormDefinitionSchema.parse({
      ...definition,
      fields: definition.fields?.map((field) => ({
        ...field,
        ...(field.label === undefined ? {} : { label: resolveVariableText(field.label, snapshot) }),
      })),
    }),
    successMessage: resolveVariableText(successMessage, snapshot),
  };
}
export function formVariableReferences(
  definition: SignupFormDefinition,
  successMessage: string,
  textReferences = variableTextReferences,
): VariableRef[] {
  return [successMessage, ...(definition.fields ?? []).map((field) => field.label ?? "")].flatMap(
    textReferences,
  );
}
/** HTML placeholders are text nodes only; URL slots must use the typed CTA reference. */
export function resolveLandingVariables(
  document: LandingPageDocument,
  snapshot: VariableSnapshot,
  formSnapshots: Record<string, VariableSnapshot> = {},
): LandingPageDocument {
  const text = (value: string) => resolveVariableText(value, snapshot);
  validateLandingVariablePlacement(document);
  const html = (value: string) => resolveVariableText(value, snapshot, { html: true });
  return landingPageDocumentSchema.parse({
    ...document,
    title: text(document.title),
    description: text(document.description),
    html: html(document.html),
    ctas: document.ctas.map((cta) => {
      const { hrefVariable, ...literal } = cta;
      if (!hrefVariable && variableTextReferences(cta.href).length)
        throw new Error("CTA URLs require a typed variable reference");
      return {
        ...literal,
        label: text(cta.label),
        href: hrefVariable ? resolveVariableRef(hrefVariable, snapshot) : cta.href,
      };
    }),
    images: document.images.map((image) => ({ ...image, alt: text(image.alt) })),
    dynamicSlots: document.dynamicSlots.map((slot) => ({
      ...slot,
      fallbackHtml: html(slot.fallbackHtml),
    })),
    forms: document.forms.map((form) => ({
      ...form,
      name: resolveVariableText(form.name, formSnapshots[form.refId] ?? snapshot),
      ...resolveFormVariables(
        form.definition,
        form.successMessage,
        formSnapshots[form.refId] ?? snapshot,
      ),
    })),
  });
}
export function landingVariableReferences(
  document: LandingPageDocument,
  textReferences = variableTextReferences,
): VariableRef[] {
  return [
    document.title,
    document.description,
    document.html,
    ...document.ctas.map((cta) => cta.label),
    ...document.images.map((image) => image.alt),
    ...document.dynamicSlots.map((slot) => slot.fallbackHtml),
    ...document.forms.filter((form) => !form.formId).map((form) => form.name),
  ]
    .flatMap(textReferences)
    .concat(
      document.ctas.flatMap((cta) => (cta.hrefVariable ? [cta.hrefVariable] : [])),
      document.forms
        .filter((form) => !form.formId)
        .flatMap((form) =>
          formVariableReferences(form.definition, form.successMessage, textReferences),
        ),
    );
}

/** Validate the source before sanitation so invalid URL references cannot disappear silently. */
export function validateLandingVariablePlacement(document: LandingPageDocument): void {
  if (/\{\{\s*variables\./.test(document.css))
    throw new Error("CSS variable substitution is not supported");
  for (const value of [document.html, ...document.dynamicSlots.map((slot) => slot.fallbackHtml)]) {
    let inTag = false,
      quote: string | null = null;
    for (let index = 0; index < value.length; index++) {
      const character = value[index];
      if (inTag && value.startsWith("{{", index))
        throw new Error(
          "Variable interpolation in an HTML attribute is not supported; use a typed CTA URL",
        );
      if (quote) {
        if (character === quote) quote = null;
        continue;
      }
      if (inTag && (character === '"' || character === "'")) {
        quote = character;
        continue;
      }
      if (character === "<") inTag = true;
      else if (character === ">") inTag = false;
    }
    for (const raw of value.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi))
      if (/\{\{\s*variables\./.test(raw[2]!))
        throw new Error("Script/style variable substitution is not supported");
  }
}
