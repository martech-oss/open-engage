// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderPublicForm } from "../../../../server/src/public/templates";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("public form browser identity changes", () => {
  it("restores required progressive fields for a different email or withdrawn consent", async () => {
    const parent = {};
    const browserWindow = {
      parent,
      addEventListener: vi.fn<(name: string, listener: (event: unknown) => void) => void>(),
    };
    const definition = {
      fields: [
        { key: "email", type: "email", required: true },
        { key: "job", kind: "custom", required: true, progressive: true },
        { key: "industry", kind: "custom", progressive: true },
      ],
      progressiveMaxFields: 1,
    };
    const html = renderPublicForm("Inquiry", definition, "https://app.test/f/acme/inquiry", {
      visitorId: "signed-token",
    });
    const body = html.match(/<body>([\s\S]*?)<script>/)?.[1];
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    document.body.innerHTML = body ?? "";
    const fetcher = vi.fn<
      (
        url: string,
        init: RequestInit,
      ) => Promise<{ ok: boolean; json: () => Promise<{ data: { answered: string[] } }> }>
    >(async (_url, init) => {
      const input = JSON.parse(typeof init.body === "string" ? init.body : "{}") as {
        email: string;
      };
      return {
        ok: true,
        json: async () => ({
          data: { answered: input.email === "alice@example.com" ? ["job"] : [] },
        }),
      };
    });
    // oxlint-disable-next-line typescript/no-implied-eval -- Execute only the application-owned generated runtime in the isolated test DOM.
    new Function("window", "document", "fetch", script ?? "")(browserWindow, document, fetcher);
    const email = document.querySelector<HTMLInputElement>('[name="email"]')!;
    const job = document.querySelector<HTMLInputElement>('[name="custom:job"]')!;
    const industry = document.querySelector<HTMLInputElement>('[name="custom:industry"]')!;
    expect(job.disabled).toBe(false);
    expect(job.required).toBe(true);
    expect(industry.disabled).toBe(true);
    email.value = "alice@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(job.disabled).toBe(true));
    expect(industry.disabled).toBe(false);
    email.value = "bob@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(job.disabled).toBe(false));
    expect(job.required).toBe(true);
    email.value = "alice@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(job.disabled).toBe(true));
    const listener = browserWindow.addEventListener.mock.calls.find(
      (call) => call[0] === "message",
    )?.[1] as (event: unknown) => void;
    listener({
      source: parent,
      origin: "https://external.example",
      data: { type: "openengage:identity", consent: false },
    });
    expect(job.disabled).toBe(false);
    expect(job.required).toBe(true);
    expect(document.querySelector('[name="oe_v"]')).toBeNull();
  });

  it("hides dependent inputs and disables required validation until their condition matches", () => {
    const html = renderPublicForm(
      "Conditional",
      {
        fields: [
          { key: "email", type: "email", required: true },
          { key: "company", kind: "custom" },
          {
            key: "size",
            kind: "custom",
            required: true,
            visibleWhen: { field: "company", operator: "not_empty" },
          },
        ],
      },
      "https://app.test/f/acme/inquiry",
    );
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<script>/)?.[1] ?? "";
    // oxlint-disable-next-line typescript/no-implied-eval -- Execute only the application-owned generated runtime in the isolated test DOM.
    new Function(
      "window",
      "document",
      "fetch",
      html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "",
    )({ parent: null, addEventListener: () => undefined }, document, vi.fn<() => void>());
    const company = document.querySelector<HTMLInputElement>('[name="custom:company"]')!;
    const size = document.querySelector<HTMLInputElement>('[name="custom:size"]')!;
    expect(size.disabled).toBe(true);
    expect(size.required).toBe(false);
    company.value = "Acme";
    company.dispatchEvent(new Event("input", { bubbles: true }));
    expect(size.disabled).toBe(false);
    expect(size.required).toBe(true);
    company.value = "";
    company.dispatchEvent(new Event("input", { bubbles: true }));
    expect(size.disabled).toBe(true);
    expect(new FormData(document.querySelector("form")!).has("custom:size")).toBe(false);
  });
});

it("returns a rotated identity to the verified parent when the referrer is absent", async () => {
  vi.spyOn(document, "referrer", "get").mockReturnValue("");
  const parent = { postMessage: vi.fn<(message: unknown, origin: string) => void>() };
  const browserWindow = {
    parent,
    addEventListener: vi.fn<(name: string, listener: (event: unknown) => void) => void>(),
  };
  const html = renderPublicForm(
    "Inquiry",
    { fields: [{ key: "email", type: "email", required: true }] },
    "https://forms.example/f/acme/inquiry",
  );
  document.body.innerHTML = html.match(/<body>([\s\S]*?)<script>/)?.[1] ?? "";
  const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) =>
    Response.json({
      data: url.endsWith("/fields")
        ? { answered: [] }
        : { visitorToken: "rotated-bob", message: "Done" },
    }),
  );
  // oxlint-disable-next-line typescript/no-implied-eval -- Run only our generated form runtime in a controlled DOM.
  new Function(
    "window",
    "document",
    "fetch",
    "location",
    html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "",
  )(browserWindow, document, fetcher, { origin: "https://forms.example" });
  const listener = browserWindow.addEventListener.mock.calls.find(
    (call) => call[0] === "message",
  )![1];
  listener({
    source: parent,
    origin: "https://external.example",
    data: { type: "openengage:identity", consent: true, visitorToken: "alice" },
  });
  listener({
    source: {},
    origin: "https://spoof.example",
    data: { type: "openengage:identity", consent: true, visitorToken: "spoof" },
  });
  const form = document.querySelector("form")!;
  form.querySelector<HTMLInputElement>('[name="email"]')!.value = "bob@example.com";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "openengage:form-identity", visitorToken: "rotated-bob" },
      "https://external.example",
    ),
  );
});
