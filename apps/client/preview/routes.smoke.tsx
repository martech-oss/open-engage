import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, waitFor, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { navigationSections, settingsSection } from "@/layouts/navigation";
import { routeTree } from "@/routeTree.gen";

import { missingFixtures, orpc, orpcQuery, previewWriteMessage } from "./mock-orpc";

const menuPaths = [
  ...new Set(
    [...navigationSections, settingsSection]
      .flatMap((section) => [section, ...section.tabs])
      .map((item) => item.to + (item.search ? `?${new URLSearchParams(item.search)}` : "")),
  ),
];
const paths = [
  ...menuPaths,
  ...[
    "overview",
    "contacts",
    "automations",
    "emails",
    "deals",
    "site",
    "campaigns",
    "lifecycle",
    "acquisition",
  ].map((view) => `/reports?view=${view}`),
  "/companies/company",
  "/lists/list-0",
  "/segments/segment-0",
  "/projects/project-0",
  "/automations/automation-0",
  "/emails",
  "/website",
  "/scoring",
  "/forms",
  "/automations/briefs",
];
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  missingFixtures.clear();
});
describe("real application routes in the UI preview", () => {
  it.each(paths)("%s renders with all required fixtures", async (path) => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [path] }),
      context: { queryClient: client },
      defaultPendingMinMs: 0,
    });
    await router.load();
    const matches = router.state.matches;
    expect(
      matches.filter((match) => match.status === "error").map((match) => String(match.error)),
    ).toEqual([]);
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(document.querySelector("main")).not.toBeNull());
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .filter((query) => query.state.fetchStatus === "fetching"),
      ).toHaveLength(0),
    );
    expect([...missingFixtures]).toEqual([]);
    expect(
      client
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.status === "error")
        .map((query) => String(query.state.error)),
    ).toEqual([]);
    expect(document.body.textContent).not.toMatch(
      /画面を読み込めませんでした|ページが見つかりません|Not Found/,
    );
  });
  it("loads the execution history after switching editor tabs", async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/automations/automation-0"] }),
      context: { queryClient: client },
    });
    await router.load();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "実行履歴" }));
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .filter((query) => query.state.fetchStatus === "fetching"),
      ).toHaveLength(0),
    );
    expect([...missingFixtures]).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("まだバッチ実行はありません。")).toBeTruthy();
  });
  it("uses zero for empty report counts instead of schema integer lower bounds", async () => {
    const acquisition = await orpc.reports.acquisition({});
    const lifecycle = await orpc.reports.lifecycle({});
    expect(acquisition.summary.visitors).toBe(0);
    expect(acquisition.summary.submittingContacts).toBe(0);
    expect(lifecycle.summary.leads).toBe(0);
    expect(lifecycle.summary.mql).toBe(0);
  });
  it("blocks writes through both RPC calling styles", async () => {
    await expect(orpc.contacts.removeFromSegment({ id: "contact-0" })).rejects.toThrow(
      previewWriteMessage,
    );
    await expect(orpcQuery.emails.createTemplate.mutationOptions().mutationFn({})).rejects.toThrow(
      previewWriteMessage,
    );
  });
});
