import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const serverRequire = createRequire(new URL("../package.json", import.meta.url));
const { build } = createRequire(serverRequire.resolve("wrangler/package.json"))("esbuild");
const { Window } = createRequire(new URL("../../client/package.json", import.meta.url))(
  "happy-dom",
);

for (const minify of [false, true]) {
  await test(`bundled public form executes visibility and submission with keepNames=true, minify=${minify}`, async () => {
    const bundled = await build({
      entryPoints: [fileURLToPath(new URL("../src/public/templates.ts", import.meta.url))],
      bundle: true,
      write: false,
      platform: "browser",
      target: "es2022",
      format: "iife",
      globalName: "PublicForms",
      keepNames: true,
      minify,
    });
    const sandbox = {};
    vm.runInNewContext(bundled.outputFiles[0].text, sandbox);
    const html = sandbox.PublicForms.renderPublicForm(
      "Contact us",
      {
        fields: [
          { key: "email", kind: "standard", type: "email", label: "Email", required: true },
          { key: "company", kind: "custom", type: "text", label: "Company" },
          {
            key: "team",
            kind: "custom",
            type: "text",
            label: "Team",
            visibleWhen: { field: "company", operator: "not_empty" },
            requiredWhen: { field: "company", operator: "equals", value: "Acme" },
          },
        ],
      },
      "https://example.com/f/workspace/form",
    );
    const browser = new Window({
      url: "https://example.com/f/workspace/form",
      settings: { disableJavaScriptEvaluation: true },
    });
    const requests = [];
    browser.fetch = async (url, options) => {
      requests.push({ url, ...options });
      return new browser.Response(JSON.stringify({ data: { message: "Registered" } }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    };
    browser.document.write(html);
    for (const script of browser.document.querySelectorAll("script:not([src])"))
      browser.eval(script.textContent);
    const form = browser.document.getElementById("signup-form");
    const company = form.querySelector('[name="custom:company"]');
    const team = form.querySelector('[name="custom:team"]');
    assert.equal(team.disabled, true);
    company.value = "Acme";
    company.dispatchEvent(new browser.Event("input", { bubbles: true }));
    assert.equal(team.disabled, false);
    assert.equal(team.required, true);
    form.querySelector('[name="email"]').value = "journey@example.com";
    team.value = "Sales";
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await browser.happyDOM.waitUntilComplete();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://example.com/f/workspace/form");
    assert.deepEqual(JSON.parse(requests[0].body), {
      email: "journey@example.com",
      "custom:company": "Acme",
      "custom:team": "Sales",
      _website: "",
      idempotencyKey: JSON.parse(requests[0].body).idempotencyKey,
    });
    assert.match(JSON.parse(requests[0].body).idempotencyKey, /^[a-f0-9-]{36}$/);
    assert.equal(browser.document.getElementById("result").textContent, "Registered");
    assert.equal(form.querySelector("button").disabled, false);
    await browser.happyDOM.close();
  });
}
