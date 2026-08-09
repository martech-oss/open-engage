import { describe, expect, it } from "vitest";

import { renderContent, renderSubject } from "./content-renderer";

describe("landing page content renderer", () => {
  it("escapes variables and rejects arbitrary HTML attributes", () => {
    const rendered = renderContent(
      {
        schemaVersion: 1,
        backgroundColor: "#f4f5f7",
        contentColor: "#ffffff",
        width: 600,
        blocks: [
          {
            id: "one",
            type: "text",
            html: '<p onclick="alert(1)">Hi {{ contact.first_name }}</p><script>alert(1)</script>',
          },
        ],
      },
      { contact: { first_name: "<Ada>" }, workspace: {} },
    );
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("onclick=");
    expect(rendered.html).toContain("&lt;Ada&gt;");
  });

  it("removes line breaks from rendered subjects", () => {
    expect(
      renderSubject("Hello {{ contact.name }}", {
        contact: { name: "A\nB" },
        workspace: {},
      }),
    ).toBe("Hello A B");
  });

  it("renders reusable message variables", () => {
    expect(
      renderSubject("{{ message.brand }}からのお知らせ", {
        contact: {},
        workspace: {},
        message: { brand: "OpenEngage" },
      }),
    ).toBe("OpenEngageからのお知らせ");
  });
});
