import { describe, expect, it } from "vitest";

import { renderPublicForm } from "./templates";

const ACTION = "https://app.example.com/f/acme/contact";

function definition(fields: unknown[], progressiveMaxFields?: number) {
  return {
    style: "inline",
    fields,
    ...(progressiveMaxFields === undefined ? {} : { progressiveMaxFields }),
  };
}

describe("renderPublicForm", () => {
  it("always asks for email, even when the definition omits it", () => {
    const html = renderPublicForm("問い合わせ", definition([]), ACTION);
    expect(html).toContain('name="email"');
    expect(html).toContain("required");
  });

  it("renders a custom field under the custom: namespace", () => {
    const html = renderPublicForm(
      "問い合わせ",
      definition([{ key: "job_title", kind: "custom", label: "役職", type: "text" }]),
      ACTION,
    );
    expect(html).toContain('name="custom:job_title"');
    expect(html).toContain("役職");
  });

  it("renders select options and textarea for the matching types", () => {
    const html = renderPublicForm(
      "問い合わせ",
      definition([
        {
          key: "company_size",
          kind: "custom",
          label: "従業員数",
          type: "select",
          options: ["1〜10名", "11名以上"],
        },
        { key: "note", kind: "custom", label: "ご要望", type: "textarea" },
      ]),
      ACTION,
    );
    expect(html).toContain('<option value="1〜10名">');
    expect(html).toContain('<textarea name="custom:note"');
  });

  it("drops a progressive field the visitor already answered", () => {
    const fields = [
      { key: "email", kind: "standard", type: "email", required: true },
      { key: "job_title", kind: "custom", label: "役職", type: "text", progressive: true },
      { key: "industry", kind: "custom", label: "業種", type: "text", progressive: true },
    ];
    const html = renderPublicForm("問い合わせ", definition(fields), ACTION, {
      answered: new Set(["job_title"]),
    });
    expect(html).not.toContain('name="custom:job_title"');
    expect(html).toContain('name="custom:industry"');
  });

  it("caps how many progressive fields one visit asks for", () => {
    const fields = [
      { key: "email", kind: "standard", type: "email", required: true },
      ...["a", "b", "c", "d"].map((key) => ({
        key,
        kind: "custom",
        label: key,
        type: "text",
        progressive: true,
      })),
    ];
    const html = renderPublicForm("問い合わせ", definition(fields, 2), ACTION);
    const shown = ["a", "b", "c", "d"].filter((key) => html.includes(`name="custom:${key}"`));
    expect(shown).toHaveLength(2);
  });

  it("keeps non-progressive fields regardless of what is already known", () => {
    const html = renderPublicForm(
      "問い合わせ",
      definition([
        { key: "email", kind: "standard", type: "email", required: true },
        { key: "phone", kind: "standard", type: "tel" },
      ]),
      ACTION,
      { answered: new Set(["phone"]) },
    );
    expect(html).toContain('name="phone"');
  });

  it("ignores a field key that could break out of the attribute", () => {
    const html = renderPublicForm(
      "問い合わせ",
      definition([{ key: 'x" onfocus="alert(1)', kind: "custom", type: "text" }]),
      ACTION,
    );
    expect(html).not.toContain("onfocus");
  });
});
