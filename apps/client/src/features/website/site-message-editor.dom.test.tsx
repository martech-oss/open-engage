// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { siteMessageSchema } from "@openengage/core/web";

import { SiteMessageEditorDialog } from "./site-message-editor-dialog";

afterEach(cleanup);

describe("site message editor audience and frequency", () => {
  it("submits all/page selections in the actual create payload", async () => {
    const create = vi.fn<() => Promise<{ id: string }>>(async () => ({ id: "created" }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SiteMessageEditorDialog
          item={null}
          open
          onOpenChange={() => {}}
          onSaved={() => {}}
          createMutation={{ mutateAsync: create }}
          updateMutation={{ mutateAsync: async () => ({ id: "cta" }) }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("対象の訪問者")).toHaveProperty("value", "identified");
    expect(screen.getByLabelText("再表示")).toHaveProperty("value", "session");
    fireEvent.change(screen.getByLabelText("管理用の名前"), { target: { value: "Public CTA" } });
    fireEvent.change(screen.getByLabelText("見出し"), { target: { value: "Welcome" } });
    fireEvent.change(screen.getByLabelText("対象の訪問者"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("再表示"), { target: { value: "page" } });
    fireEvent.submit(screen.getByLabelText("見出し").closest("form")!);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ audience: "all", frequency: "page" }),
      ),
    );
  });

  it("restores stored settings and allows reverting to identified/session", async () => {
    const update = vi.fn<() => Promise<{ id: string }>>(async () => ({ id: "cta" }));
    const item = siteMessageSchema.parse({
      id: "cta",
      name: "Help",
      headline: "Welcome",
      body: "",
      ctaLabel: "",
      ctaUrl: null,
      pagePattern: "*",
      status: "draft",
      startsAt: null,
      endsAt: null,
      audience: "all",
      frequency: "page",
      impressionCount: 0,
      clickCount: 0,
      createdAt: "2026-09-09",
      updatedAt: "2026-09-09",
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SiteMessageEditorDialog
          item={item}
          open
          onOpenChange={() => {}}
          onSaved={() => {}}
          createMutation={{ mutateAsync: async () => ({ id: "created" }) }}
          updateMutation={{ mutateAsync: update }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("対象の訪問者")).toHaveProperty("value", "all");
    expect(screen.getByLabelText("再表示")).toHaveProperty("value", "page");
    fireEvent.change(screen.getByLabelText("対象の訪問者"), { target: { value: "identified" } });
    fireEvent.change(screen.getByLabelText("再表示"), { target: { value: "session" } });
    fireEvent.submit(screen.getByLabelText("見出し").closest("form")!);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cta", audience: "identified", frequency: "session" }),
      ),
    );
  });
});
