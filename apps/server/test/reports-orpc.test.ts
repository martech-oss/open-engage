import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { seedWorkspaceClient } from "./factory";

/**
 * The five report output schemas are transcriptions of what the query functions
 * build. tsc only checks they are structurally compatible; oRPC validates the
 * real payload at runtime and is stricter (.int() rejects a float, a missing key
 * fails). This drives all five against seeded data so a wrong schema fails here
 * rather than in the browser.
 */
describe("reports over oRPC", () => {
  it("validates every report's output schema against real data", async () => {
    const { client } = await seedWorkspaceClient(env.DB, { timezone: "Asia/Tokyo" });

    // give the reports something to count
    await client.contacts.create({ email: "r@example.com", stage: "lead", customFields: {} });

    // reportDateRangeSchema caps the span at 366 days, and the seeded contact is
    // created now, so the window has to end today.
    const today = new Date();
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 29);
    const range = {
      from: from.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
    };
    const [contacts, automations, emails, deals, site] = await Promise.all([
      client.reports.contacts(range),
      client.reports.automations(range),
      client.reports.emails(range),
      client.reports.deals({ ...range, currency: "JPY" }),
      client.reports.site(range),
    ]);

    expect(contacts.category).toBe("contacts");
    expect(contacts.summary.totalContacts).toBe(1);
    expect(contacts.range).toEqual(range);
    expect(automations.category).toBe("automations");
    expect(emails.category).toBe("emails");
    expect(deals.category).toBe("deals");
    expect(deals.currency).toBe("JPY");
    expect(site.category).toBe("site");
    expect(site.notes.messageMetrics).toEqual(expect.any(String));

    await expect(client.reports.overview({ ...range, currency: "JPY" })).resolves.toEqual({
      contacts,
      automations,
      emails,
      deals,
      site,
    });
  });

  it("rejects a report request below analyst", async () => {
    const { client } = await seedWorkspaceClient(env.DB, { role: "viewer" });

    await expect(
      client.reports.contacts({ from: "2024-01-01", to: "2024-01-31" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(
      client.reports.overview({ from: "2024-01-01", to: "2024-01-31" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(client.dashboard.get()).resolves.toMatchObject({ timezone: "UTC" });
  });
});
