import assert from "node:assert/strict";
import { test } from "node:test";

import { deployConfigProblems, deployTarget } from "./deploy-config.mjs";

await test("refuses the development defaults checked into wrangler.jsonc", () => {
  assert.equal(
    deployConfigProblems({ ENVIRONMENT: "development", APP_URL: "http://localhost:5173" }).length,
    2,
  );
});

await test("refuses development mode even with a public APP_URL", () => {
  assert.equal(
    deployConfigProblems({ ENVIRONMENT: "development", APP_URL: "https://app.example.com" }).length,
    1,
  );
});

await test("refuses a production config that still points at a local or missing APP_URL", () => {
  assert.equal(
    deployConfigProblems({ ENVIRONMENT: "production", APP_URL: "http://127.0.0.1:5173" }).length,
    1,
  );
  assert.equal(deployConfigProblems({ ENVIRONMENT: "production" }).length, 1);
});

await test("refuses a production APP_URL that is not HTTPS", () => {
  for (const APP_URL of ["http://app.example.com", "ftp://app.example.com"])
    assert.equal(deployConfigProblems({ ENVIRONMENT: "production", APP_URL }).length, 1);
});

await test("accepts the configuration the setup CLI writes", () => {
  assert.deepEqual(
    deployConfigProblems({ ENVIRONMENT: "production", APP_URL: "https://app.example.com" }),
    [],
  );
});

await test("checks the environment and config file that wrangler deploy will select", () => {
  assert.deepEqual(deployTarget([], undefined), { config: undefined, environment: undefined });
  assert.deepEqual(deployTarget([], "staging"), { config: undefined, environment: "staging" });
  // --env takes precedence over CLOUDFLARE_ENV, as it does for Wrangler.
  assert.deepEqual(deployTarget(["--env", "production"], "staging"), {
    config: undefined,
    environment: "production",
  });
  assert.deepEqual(deployTarget(["--env=staging", "--config=other.jsonc"], undefined), {
    config: "other.jsonc",
    environment: "staging",
  });
  assert.deepEqual(deployTarget(["-e", "staging", "-c", "other.jsonc", "--dry-run"], undefined), {
    config: "other.jsonc",
    environment: "staging",
  });
});
