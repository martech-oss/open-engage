import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  cloudflareResourceNames,
  initialWorkerDeployCommands,
  readConfiguredResources,
  rewriteWorkerConfigs,
  type WorkerConfigInput,
} from "./provisioning";

function provisioningInput(server: string): WorkerConfigInput {
  return {
    projectName: "acme-engage",
    appUrl: "https://ma.acme.example",
    databaseId: "database-id",
    transactionalFromEmail: "notifications@mail.acme.example",
    transactionalFromName: "Acme Engage",
    turnstileSiteKey: "",
    server,
    agent: "{}",
    client: "{}",
  };
}

describe("three Worker provisioning", () => {
  it("enables production authentication in the actual server template", async () => {
    const template = await readFile(
      fileURLToPath(new URL("../../../apps/server/wrangler.jsonc", import.meta.url)),
      "utf8",
    );

    const result = rewriteWorkerConfigs(provisioningInput(template));

    expect(JSON.parse(result.server).vars).toMatchObject({
      ENVIRONMENT: "production",
      APP_URL: "https://ma.acme.example",
    });
  });

  it.each([
    ["compact JSON", '"ENVIRONMENT":"development"'],
    ["whitespace", '"ENVIRONMENT"\n :\t"development"'],
    ["comments", '"ENVIRONMENT" /* key */ : /* value */ "development"'],
    ["escaped key", String.raw`"\u0045NVIRONMENT": "development"`],
    ["escaped value", String.raw`"ENVIRONMENT": "develo\u0070ment"`],
    [
      "duplicate keys ending in development",
      '"ENVIRONMENT": "production", "ENVIRONMENT": "development"',
    ],
    [
      "duplicate keys ending in production",
      '"ENVIRONMENT": "development", "ENVIRONMENT": "production"',
    ],
    ["existing production", '"ENVIRONMENT": "production"'],
  ])("keeps provisioning production-safe for %s", (_name, setting) => {
    const input = provisioningInput(`{"vars": {${setting},"APP_NAME":"Custom app"}}`);

    const result = rewriteWorkerConfigs(input);

    expect(JSON.parse(result.server)).toEqual({
      vars: { ENVIRONMENT: "production", APP_NAME: "Custom app" },
    });
    expect(rewriteWorkerConfigs({ ...input, ...result })).toEqual(result);
  });

  it("uses the final root vars object and preserves other configuration values", () => {
    const input = provisioningInput(String.raw`{
      // "ENVIRONMENT": "development" is only documentation here.
      "ENVIRONMENT": "development",
      "vars": {"ENVIRONMENT": "production", "DISCARDED": "first vars"},
      "\u0076ars": {
        "ENVIRONMENT": "develo\u0070ment",
        "NOTE": "\"ENVIRONMENT\": \"development\""
      },
      "env": {"preview": {"vars": {"ENVIRONMENT": "development"}}},
      "metadata": {"vars": {"ENVIRONMENT": "development"}}
    }`);

    const result = rewriteWorkerConfigs(input);

    expect(JSON.parse(result.server)).toEqual({
      ENVIRONMENT: "development",
      vars: { ENVIRONMENT: "production", NOTE: '"ENVIRONMENT": "development"' },
      env: { preview: { vars: { ENVIRONMENT: "development" } } },
      metadata: { vars: { ENVIRONMENT: "development" } },
    });
  });

  it("adds the production binding when vars is absent", () => {
    const result = rewriteWorkerConfigs(provisioningInput('{"name": "custom-server"}'));

    expect(JSON.parse(result.server)).toEqual({
      name: "custom-server",
      vars: { ENVIRONMENT: "production" },
    });
  });

  it.each([
    ["invalid JSONC", '{"vars": {"ENVIRONMENT": "development"}'],
    ["non-object root", "[]"],
    ["null root", "null"],
    ["non-object vars", '{"vars": []}'],
    ["null vars", '{"vars": null}'],
    ["non-string environment", '{"vars": {"ENVIRONMENT": false}}'],
  ])("rejects %s before generating a config", (_name, server) => {
    expect(() => rewriteWorkerConfigs(provisioningInput(server))).toThrow();
  });

  it("catches generated Worker config dropping the prompted Turnstile site key", () => {
    const input = {
      projectName: "acme-engage",
      appUrl: "https://ma.acme.example",
      databaseId: "database-id",
      transactionalFromEmail: "notifications@mail.acme.example",
      transactionalFromName: "Acme Engage",
      turnstileSiteKey: "0x4AAAA-site-key",
      server: '{"vars": {"TURNSTILE_SITE_KEY": ""}}',
      agent: "{}",
      client: "{}",
    };

    const result = rewriteWorkerConfigs(input);

    expect(JSON.parse(result.server).vars).toEqual({
      TURNSTILE_SITE_KEY: "0x4AAAA-site-key",
      ENVIRONMENT: "production",
    });
  });

  it("rewrites both sides of every service binding", () => {
    const result = rewriteWorkerConfigs({
      projectName: "acme-engage",
      appUrl: "https://ma.acme.example",
      databaseId: "database-id",
      transactionalFromEmail: "notifications@mail.acme.example",
      transactionalFromName: "Acme Engage",
      turnstileSiteKey: "0x4AAAA-test-site-key",
      server:
        '{"name": "openengage-server", "service": "openengage-agent", "database_name": "openengage-db", "database_id": "00000000-0000-0000-0000-000000000000", "bucket_name": "openengage-assets", "queues": [{"queue": "openengage-program-member-import"}, {"queue": "openengage-jobs"}, {"queue": "openengage-delivery"}, {"queue": "openengage-dead-letter"}, {"queue": "openengage-email-events"}], "send_email": [{"name": "EMAIL", "allowed_sender_addresses": ["notifications@example.com"]}], "vars": {"APP_URL": "http://localhost:5173", "ENVIRONMENT": "development", "TRANSACTIONAL_FROM_EMAIL": "notifications@example.com", "TRANSACTIONAL_FROM_NAME": "OpenEngage", "TURNSTILE_SITE_KEY": ""}}',
      agent:
        '{"name": "openengage-agent", "env": {"bootstrap": {"name": "openengage-agent"}}, "service": "openengage-server"}',
      client: '{"name": "openengage", "service": "openengage-server"}',
    });

    expect(result.server).toContain('"name": "acme-engage-server"');
    expect(result.server).toContain('"service": "acme-engage-agent"');
    expect(result.server).toContain('"database_id": "database-id"');
    expect(result.server).toContain("acme-engage-email-events");
    expect(result.server).toContain("acme-engage-program-member-import");
    expect(Object.values(cloudflareResourceNames("acme-engage").queues)).toContain(
      "acme-engage-program-member-import",
    );
    expect(result.server).toContain("notifications@mail.acme.example");
    expect(result.server).toContain('"TRANSACTIONAL_FROM_NAME": "Acme Engage"');
    expect(result.server).toContain('"TURNSTILE_SITE_KEY": "0x4AAAA-test-site-key"');
    expect(result.agent).toContain('"name": "acme-engage-agent"');
    expect(result.agent).toContain('"service": "acme-engage-server"');
    expect(result.client).toBe('{"name": "acme-engage", "service": "acme-engage-server"}');
    expect(readConfiguredResources(result.server)).toEqual({
      database: "acme-engage-db",
      bucket: "acme-engage-assets",
      queues: Object.values(cloudflareResourceNames("acme-engage").queues),
      fromEmail: "notifications@mail.acme.example",
      sendingDomain: "mail.acme.example",
      emailEventsQueue: "acme-engage-email-events",
      hasEmailBinding: true,
    });
    expect(cloudflareResourceNames("acme-engage").queues.emailEvents).toBe(
      "acme-engage-email-events",
    );
  });

  it("lets doctor verify every resource create provisions for the template config", async () => {
    const template = await readFile(
      fileURLToPath(new URL("../../../apps/server/wrangler.jsonc", import.meta.url)),
      "utf8",
    );
    const expected = cloudflareResourceNames("openengage");

    const configured = readConfiguredResources(template);

    expect(configured.database).toBe(expected.database);
    expect(configured.bucket).toBe(expected.bucket);
    expect(configured.queues).toEqual(expect.arrayContaining(Object.values(expected.queues)));
    expect(configured.queues).toHaveLength(Object.values(expected.queues).length);
  });

  it("deploys bootstrap before the normal server-agent-client sequence", () => {
    expect(initialWorkerDeployCommands).toEqual([
      ["--filter", "@openengage/agent", "deploy:bootstrap"],
      ["deploy"],
    ]);
  });
});
