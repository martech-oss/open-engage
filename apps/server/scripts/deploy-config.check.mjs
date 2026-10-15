import assert from "node:assert/strict";
import { test } from "node:test";

import { deployConfigProblems } from "./deploy-config.mjs";

test("refuses the development defaults checked into wrangler.jsonc", () => {
  assert.equal(
    deployConfigProblems({ ENVIRONMENT: "development", APP_URL: "http://localhost:5173" }).length,
    2,
  );
});

test("refuses development mode even with a public APP_URL", () => {
  assert.equal(
    deployConfigProblems({ ENVIRONMENT: "development", APP_URL: "https://app.example.com" }).length,
    1,
  );
});

test("refuses a production config that still points at a local or missing APP_URL", () => {
  assert.equal(
    deployConfigProblems({ ENVIRONMENT: "production", APP_URL: "http://127.0.0.1:5173" }).length,
    1,
  );
  assert.equal(deployConfigProblems({ ENVIRONMENT: "production" }).length, 1);
});

test("accepts the configuration the setup CLI writes", () => {
  assert.deepEqual(
    deployConfigProblems({ ENVIRONMENT: "production", APP_URL: "https://app.example.com" }),
    [],
  );
});
