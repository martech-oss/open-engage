import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase, uuidv7 } from "@openengage/database/testing";

import { getDashboard } from "../src/reports/dashboard-service";
import { seedAutomationJob } from "./automation-recovery-test-support";
import { observeQueries } from "./query-observer";

const now = "2026-09-08T12:00:00.000Z";

describe("dashboard scoped aggregates", () => {
  it("counts all 201 drafts and ranks an active automation outside the latest 200", async () => {
    const f = await seedAutomationJob({ status: "pending", createdAt: "2026-08-01T00:00:00.000Z" });
    await env.DB.batch(
      Array.from({ length: 201 }, () =>
        env.DB.prepare(
          "INSERT INTO automations(id,workspace_id,name,status,created_at,updated_at) VALUES (?,?,'Draft','draft',?,?)",
        ).bind(uuidv7(), f.workspaceId, now, now),
      ),
    );
    const captured = observeQueries(env.DB);
    const started = performance.now();
    const dashboard = await getDashboard(createDatabase(captured.database), f.workspaceId, { now });
    console.info(
      "dashboard benchmark",
      JSON.stringify({
        ...captured.metrics,
        sql: undefined,
        elapsedMs: performance.now() - started,
      }),
    );
    expect(dashboard.automations).toMatchObject({ count: 1, draftCount: 201, enrolledCount: 1 });
    expect(dashboard.automations.top).toHaveLength(1);
    expect(dashboard.automations.top[0]).toMatchObject({ active: 1 });
    expect(captured.metrics.calls).toBe(11);
    expect(captured.metrics.resultBytes).toBeLessThan(5000);
  });

  it("excludes queued emails and webhooks and counts historical email delivery success", async () => {
    const f = await seedAutomationJob({ status: "pending" });
    const failedId = uuidv7();
    await env.DB.batch([
      ...[
        [uuidv7(), "email", "queued"],
        [uuidv7(), "webhook", "delivered"],
        [failedId, "email", "failed"],
        [uuidv7(), "email", "accepted"],
      ].map(([id, channel, status]) =>
        env.DB.prepare(
          "INSERT INTO deliveries(id,workspace_id,contact_id,channel,purpose,provider,recipient,idempotency_key,payload,status,attempts,created_at,updated_at) VALUES (?,?,?,?,'transactional','cloudflare','recipient@example.com',?,'{}',?,1,?,?)",
        ).bind(id, f.workspaceId, f.contactId, channel, id, status, now, now),
      ),
      env.DB.prepare(
        "INSERT INTO delivery_events(id,workspace_id,delivery_id,provider,provider_event_id,type,occurred_at,created_at) VALUES (?,?,?,'cloudflare',?,'delivered',?,?)",
      ).bind(uuidv7(), f.workspaceId, failedId, uuidv7(), now, now),
    ]);
    const dashboard = await getDashboard(createDatabase(env.DB), f.workspaceId, { now });
    expect(dashboard.deliveries).toMatchObject({
      sent: 2,
      delivered: 1,
      failed: 1,
      deliveryRate: 50,
    });
    expect(dashboard.deliveries.health.points.at(-1)).toMatchObject({
      sends: 2,
      delivered: 1,
      undelivered: 1,
    });
  });
});
