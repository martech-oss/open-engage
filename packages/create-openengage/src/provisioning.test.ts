import { describe, expect, it } from "vitest";

import {
  cloudflareResourceNames,
  initialWorkerDeployCommands,
  readConfiguredResources,
  rewriteWorkerConfigs,
} from "./provisioning";

describe("three Worker provisioning", () => {
  it("catches generated Worker config dropping the prompted Turnstile site key", () => {
    const input = {
      projectName: "acme-engage",
      appUrl: "https://ma.acme.example",
      databaseId: "database-id",
      transactionalFromEmail: "notifications@mail.acme.example",
      transactionalFromName: "Acme Engage",
      turnstileSiteKey: "0x4AAAA-site-key",
      server: '{"TURNSTILE_SITE_KEY": ""}',
      agent: "{}",
      client: "{}",
    };

    const result = rewriteWorkerConfigs(input);

    expect(result.server).toBe('{"TURNSTILE_SITE_KEY": "0x4AAAA-site-key"}');
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
        '{"name": "openengage-server", "service": "openengage-agent", "database_name": "openengage-db", "database_id": "00000000-0000-0000-0000-000000000000", "APP_URL": "http://localhost:5173", "bucket": "openengage-assets", "queues": [{"queue": "openengage-program-member-import"}, {"queue": "openengage-jobs"}, {"queue": "openengage-delivery"}, {"queue": "openengage-dead-letter"}, {"queue": "openengage-email-events"}], "send_email": [{"name": "EMAIL", "allowed_sender_addresses": ["notifications@example.com"]}], "TRANSACTIONAL_FROM_EMAIL": "notifications@example.com", "TRANSACTIONAL_FROM_NAME": "OpenEngage", "TURNSTILE_SITE_KEY": ""}',
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
      fromEmail: "notifications@mail.acme.example",
      sendingDomain: "mail.acme.example",
      emailEventsQueue: "acme-engage-email-events",
      hasEmailBinding: true,
    });
    expect(cloudflareResourceNames("acme-engage").queues.emailEvents).toBe(
      "acme-engage-email-events",
    );
  });

  it("deploys bootstrap before the normal server-agent-client sequence", () => {
    expect(initialWorkerDeployCommands).toEqual([
      ["--filter", "@openengage/agent", "deploy:bootstrap"],
      ["deploy"],
    ]);
  });
});
