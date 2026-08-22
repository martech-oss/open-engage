import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataTable } from "@/components/data-table";

import { customRedirectColumns } from "./custom-redirects-view";
import { landingPageColumns } from "./landing-pages-view";
import { signupFormColumns } from "./signup-forms-view";
import type { CustomRedirectRow, LandingPageRow, SignupFormRow } from "./website-api";

const noop = () => undefined;
const archive = async () => undefined;
const timestamp = "2026-08-23T00:00:00.000Z";

describe("website resource tables on SSR", () => {
  it.each([
    {
      name: "signup form",
      row: {
        id: "form-1",
        name: "Newsletter",
        slug: "newsletter",
        status: "published",
        version: 2,
        definition: { style: "inline", fields: [], progressiveMaxFields: 3 },
        allowedDomains: [],
        turnstileEnabled: true,
        successMessage: "Thanks",
        submissionCount: 4,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies SignupFormRow,
      columns: signupFormColumns({
        formatDateTime: (value) => value,
        onEdit: noop,
        onArchive: archive,
        publicUrls: (item) => ({
          page: `https://public.example/f/workspace/${item.slug}`,
          embed: `https://public.example/api/public/forms/workspace/${item.slug}/embed.js`,
        }),
      }),
    },
    {
      name: "landing page",
      row: {
        id: "page-1",
        name: "Campaign",
        slug: "campaign",
        status: "published",
        currentVersionId: "version-1",
        version: 1,
        contentDocument: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies LandingPageRow,
      columns: landingPageColumns({
        formatDateTime: (value) => value,
        onEdit: noop,
        onArchive: archive,
        publicUrl: (item) => `https://public.example/p/workspace/${item.slug}`,
      }),
    },
    {
      name: "custom redirect",
      row: {
        id: "redirect-1",
        name: "Ad",
        slug: "ad",
        destinationUrl: "https://destination.example/",
        clickCount: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies CustomRedirectRow,
      columns: customRedirectColumns({
        formatDateTime: (value) => value,
        onEdit: noop,
        onArchive: archive,
        publicUrl: (item) => `https://public.example/r/workspace/${item.slug}`,
      }),
    },
  ])("renders a non-empty $name table without browser globals", ({ row, columns }) => {
    expect(() =>
      renderToStaticMarkup(
        <DataTable
          columns={columns as never}
          rows={[row] as never[]}
          rowKey={() => "row"}
          caption="resource"
          emptyTitle="empty"
          emptyDescription="empty"
        />,
      ),
    ).not.toThrow();
  });
});
