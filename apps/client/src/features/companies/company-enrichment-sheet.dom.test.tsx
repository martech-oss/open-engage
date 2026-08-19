// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyEnrichmentResult } from "@openengage/core/contacts";

import { CompanyEnrichmentSheet } from "./company-enrichment-sheet";

const enrichment = vi.hoisted(() => ({
  mutateAsync: vi.fn<(input: unknown) => Promise<CompanyEnrichmentResult>>(),
  reset: vi.fn<() => void>(),
  isPending: false,
}));

vi.mock("./company-api", () => ({ useEnrichCompany: () => enrichment }));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <section>{children}</section> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  SheetFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  SheetHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

beforeEach(() => {
  enrichment.mutateAsync.mockReset();
  enrichment.reset.mockReset();
  enrichment.isPending = false;
});

afterEach(cleanup);

describe("CompanyEnrichmentSheet request authority", () => {
  it("keeps company B when company A later fails", async () => {
    const companyA = deferred<CompanyEnrichmentResult>();
    const companyB = deferred<CompanyEnrichmentResult>();
    enrichment.mutateAsync
      .mockReturnValueOnce(companyA.promise)
      .mockReturnValueOnce(companyB.promise);
    const props = companyProps("company-a");
    const view = render(<CompanyEnrichmentSheet {...props} />);
    clickResearch();

    view.rerender(
      <CompanyEnrichmentSheet {...props} source={{ source: "company", companyId: "company-b" }} />,
    );
    clickResearch();
    await settle(companyB, readyCompany("Company B", "b.example"));
    expect(await screen.findByText("候補: Company B")).toBeTruthy();

    await reject(companyA, new Error("company A failed"));
    expect(screen.queryByText("company A failed")).toBeNull();
    expect(screen.getByText("候補: Company B")).toBeTruthy();
  });

  it("keeps the current result after close/reopen with the same source", async () => {
    const oldSession = deferred<CompanyEnrichmentResult>();
    const currentSession = deferred<CompanyEnrichmentResult>();
    enrichment.mutateAsync
      .mockReturnValueOnce(oldSession.promise)
      .mockReturnValueOnce(currentSession.promise);
    const props = companyProps("company-a");
    const view = render(<CompanyEnrichmentSheet {...props} />);
    clickResearch();

    view.rerender(<CompanyEnrichmentSheet {...props} open={false} />);
    view.rerender(<CompanyEnrichmentSheet {...props} open />);
    clickResearch();
    await settle(currentSession, readyCompany("Current Company", "current.example"));
    expect(await screen.findByText("候補: Current Company")).toBeTruthy();

    await settle(oldSession, readyCompany("Stale Company", "stale.example"));
    expect(screen.queryByText("候補: Stale Company")).toBeNull();
    expect(screen.getByText("候補: Current Company")).toBeTruthy();
  });

  it("does not close a new company session when an old apply succeeds", async () => {
    enrichment.mutateAsync.mockResolvedValueOnce(readyCompany("Company A", "a.example"));
    const applyA = deferred<void>();
    const onApply = vi.fn<(values: { name?: string; domain?: string }) => Promise<void>>(
      () => applyA.promise,
    );
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const props = { ...companyProps("company-a"), onApply, onOpenChange };
    const view = render(<CompanyEnrichmentSheet {...props} />);
    clickResearch();
    expect(await screen.findByText("候補: Company A")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "選択した項目を反映" }));

    view.rerender(
      <CompanyEnrichmentSheet {...props} source={{ source: "company", companyId: "company-b" }} />,
    );
    await settle(applyA, undefined);

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "会社情報を取得" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("does not show an old apply error or finally state in a reopened session", async () => {
    enrichment.mutateAsync.mockResolvedValueOnce(readyCompany("Company A", "a.example"));
    const applyA = deferred<void>();
    const props = {
      ...companyProps("company-a"),
      onApply: vi.fn<(values: { name?: string; domain?: string }) => Promise<void>>(
        () => applyA.promise,
      ),
    };
    const view = render(<CompanyEnrichmentSheet {...props} />);
    clickResearch();
    expect(await screen.findByText("候補: Company A")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "選択した項目を反映" }));

    view.rerender(<CompanyEnrichmentSheet {...props} open={false} />);
    view.rerender(<CompanyEnrichmentSheet {...props} open />);
    await reject(applyA, new Error("stale apply failure"));

    expect(screen.queryByText("stale apply failure")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "会社情報を取得" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

function companyProps(companyId: string): Parameters<typeof CompanyEnrichmentSheet>[0] {
  return {
    open: true,
    onOpenChange: vi.fn<(open: boolean) => void>(),
    source: { source: "company", companyId },
    currentName: "",
    currentDomain: "",
    onApply: vi.fn<(values: { name?: string; domain?: string }) => Promise<void>>(
      async () => undefined,
    ),
  };
}

function clickResearch(): void {
  fireEvent.click(screen.getByRole("button", { name: "会社情報を取得" }));
}

function readyCompany(name: string, domain: string): CompanyEnrichmentResult {
  return {
    status: "ready",
    proposal: {
      fields: {
        officialName: { value: name, confidence: "high", sourceIds: ["official"] },
        domain: { value: domain, confidence: "high", sourceIds: ["official"] },
      },
      sources: [
        {
          id: "official",
          url: `https://${domain}/`,
          title: `${name} official site`,
          kind: "official",
          retrievedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
      warnings: [],
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function settle<T>(pending: ReturnType<typeof deferred<T>>, value: T): Promise<void> {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}

async function reject<T>(pending: ReturnType<typeof deferred<T>>, reason: unknown): Promise<void> {
  await act(async () => {
    pending.reject(reason);
    await pending.promise.catch(() => undefined);
  });
}
