import { describe, expect, it } from "vitest";

import { createVariableSnapshot } from "../projects/variables";
import * as web from "./index";
import { emptyLandingPageDocument, landingPageDocumentSchema } from "./landing-document";
const snapshot = createVariableSnapshot(
  [
    {
      id: "1",
      workspaceId: "ws",
      projectId: null,
      key: "title",
      type: "string",
      value: '<img onerror="bad">',
      revision: 1,
      updatedAt: "",
    },
    {
      id: "2",
      workspaceId: "ws",
      projectId: null,
      key: "target",
      type: "url",
      value: "https://example.com/event",
      revision: 1,
      updatedAt: "",
    },
  ],
  "ws",
  null,
);
describe("web variable publication", () => {
  it("resolves only display slots and typed CTA URLs while retaining resource IDs", () => {
    expect(typeof web.resolveLandingVariables).toBe("function");
    const doc = landingPageDocumentSchema.parse({
      ...emptyLandingPageDocument(),
      title: "{{variables.title}}",
      html: "<h1>{{variables.title}}</h1>",
      ctas: [
        {
          refId: "cta",
          label: "{{variables.title}}",
          href: "https://old.example",
          hrefVariable: { kind: "variable", key: "target", type: "url" },
        },
      ],
      images: [{ refId: "img", assetId: "{{variables.title}}", alt: "{{variables.title}}" }],
    });
    const resolved = web.resolveLandingVariables(doc, snapshot);
    expect(resolved.html).toContain("&lt;img onerror=&quot;bad&quot;&gt;");
    expect(resolved.ctas[0]!.href).toBe("https://example.com/event");
    expect(resolved.images[0]!.assetId).toBe("{{variables.title}}");
    expect(doc.title).toBe("{{variables.title}}");
  });
  it("refuses interpolation in HTML attributes and CSS", () => {
    expect(typeof web.resolveLandingVariables).toBe("function");
    expect(() =>
      web.resolveLandingVariables(
        { ...emptyLandingPageDocument(), html: '<a href="{{variables.title}}">link</a>' },
        snapshot,
      ),
    ).toThrow(/attribute/i);
    expect(() =>
      web.resolveLandingVariables(
        { ...emptyLandingPageDocument(), css: "body{color:{{variables.title}}}" },
        snapshot,
      ),
    ).toThrow(/CSS/i);
  });
  it("freezes form labels and completion text without changing submission keys or option values", () => {
    expect(typeof web.resolveFormVariables).toBe("function");
    const result = web.resolveFormVariables(
      {
        progressiveMaxFields: 3,
        fields: [
          {
            key: "email",
            label: "{{variables.title}}",
            type: "email",
            kind: "standard",
            required: true,
            progressive: false,
          },
        ],
      },
      "Thanks {{variables.title}}",
      snapshot,
    );
    expect(result.definition.fields?.[0]).toMatchObject({
      key: "email",
      label: '<img onerror="bad">',
    });
    expect(result.successMessage).toBe('Thanks <img onerror="bad">');
  });
});
it("keeps a shared form on its own explicit variable context when embedded in another Project", () => {
  const formSnapshot = createVariableSnapshot(
    [
      {
        id: "f",
        workspaceId: "ws",
        projectId: "form-project",
        key: "title",
        type: "string",
        value: "Shared form",
        revision: 1,
        updatedAt: "",
      },
    ],
    "ws",
    "form-project",
  );
  const document = landingPageDocumentSchema.parse({
    ...emptyLandingPageDocument(),
    title: "{{variables.title}}",
    forms: [
      {
        refId: "signup",
        formId: "shared",
        name: "{{variables.title}}",
        definition: { fields: [{ key: "email", label: "{{variables.title}}" }] },
        successMessage: "{{variables.title}}",
        turnstileEnabled: false,
      },
    ],
  });
  const resolved = web.resolveLandingVariables(document, snapshot, { signup: formSnapshot });
  expect(resolved.forms[0]!.successMessage).toBe("Shared form");
  expect(resolved.forms[0]!.name).toBe("Shared form");
  expect(resolved.title).toBe('<img onerror="bad">');
});
it("refuses variable URL bypass inside an attribute containing a quoted greater-than sign", () => {
  expect(() =>
    web.resolveLandingVariables(
      { ...emptyLandingPageDocument(), html: '<a title=">" href="{{variables.title}}">link</a>' },
      snapshot,
    ),
  ).toThrow(/attribute/i);
});
