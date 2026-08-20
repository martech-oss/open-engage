// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultEmailDocumentV2,
  type EmailGenerationProposal,
  type EmailGenerationResult,
  type GeneratedEmailImage,
} from "@openengage/core/messaging";

import { EmailAiSheet } from "./email-ai-sheet";

type MutationDouble = {
  mutateAsync: ReturnType<typeof vi.fn<(input: unknown) => Promise<unknown>>>;
  reset: ReturnType<typeof vi.fn<() => void>>;
  isPending: boolean;
};

const mutations = vi.hoisted(() => {
  const create = (): MutationDouble => ({
    mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>(),
    reset: vi.fn<() => void>(),
    isPending: false,
  });
  return { generate: create(), preview: create(), image: create() };
});

vi.mock("./email-api", () => ({
  useGenerateEmailTemplate: () => mutations.generate,
  usePreviewEmailTemplate: () => mutations.preview,
  useGenerateEmailImage: () => mutations.image,
}));

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
  for (const mutation of Object.values(mutations)) {
    mutation.mutateAsync.mockReset();
    mutation.reset.mockReset();
    mutation.isPending = false;
  }
});

afterEach(cleanup);

describe("EmailAiSheet request authority", () => {
  it("ignores generation from a previous close/open session", async () => {
    const oldGeneration = deferred<EmailGenerationResult>();
    mutations.generate.mutateAsync.mockReturnValueOnce(oldGeneration.promise);
    mutations.preview.mutateAsync.mockResolvedValue({ subject: "preview", html: "new", text: "" });
    const props = emailProps({ entityId: "template-a", open: true });
    const view = render(<EmailAiSheet {...props} />);
    startEmailGeneration("old request");

    view.rerender(<EmailAiSheet {...props} open={false} />);
    view.rerender(<EmailAiSheet {...props} open />);
    await settle(oldGeneration, emailResult("stale proposal"));

    expect(screen.queryByText("stale proposal")).toBeNull();
  });

  it.each([
    ["entity", { entityId: "template-b" }],
    ["mode", { mode: "create" as const, entityId: undefined }],
    ["purpose", { purpose: "marketing" as const }],
  ])("ignores generation after a %s identity change", async (_label, change) => {
    const generation = deferred<EmailGenerationResult>();
    mutations.generate.mutateAsync.mockReturnValueOnce(generation.promise);
    mutations.preview.mutateAsync.mockResolvedValue({ subject: "preview", html: "new", text: "" });
    const props = emailProps({ entityId: "template-a", mode: "refine", open: true });
    const view = render(<EmailAiSheet {...props} />);
    startEmailGeneration("old request");

    view.rerender(<EmailAiSheet {...props} {...change} />);
    await settle(generation, emailResult("stale proposal"));

    expect(screen.queryByText("stale proposal")).toBeNull();
  });

  it("keeps generation visible progressively but lets only the current preview commit", async () => {
    const previewA = deferred<{ subject: string; html: string; text: string }>();
    const previewB = deferred<{ subject: string; html: string; text: string }>();
    mutations.generate.mutateAsync
      .mockResolvedValueOnce(emailResult("proposal A"))
      .mockResolvedValueOnce(emailResult("proposal B"));
    mutations.preview.mutateAsync
      .mockReturnValueOnce(previewA.promise)
      .mockReturnValueOnce(previewB.promise);
    const props = emailProps({ entityId: "template-a", open: true });
    const view = render(<EmailAiSheet {...props} />);
    startEmailGeneration("request A");
    await screen.findByText("proposal A");

    view.rerender(<EmailAiSheet {...props} entityId="template-b" />);
    startEmailGeneration("request B");
    await screen.findByText("proposal B");

    await settle(previewA, { subject: "stale", html: "stale-html", text: "" });
    expect(screen.queryByTitle("AIメール提案プレビュー")?.getAttribute("srcdoc")).not.toBe(
      "stale-html",
    );

    await settle(previewB, { subject: "current", html: "current-html", text: "" });
    await waitFor(() =>
      expect(screen.getByTitle("AIメール提案プレビュー").getAttribute("srcdoc")).toBe(
        "current-html",
      ),
    );
  });

  it("uses independent latest-wins authority for generated images", async () => {
    const imageA = deferred<GeneratedEmailImage>();
    const imageB = deferred<GeneratedEmailImage>();
    mutations.generate.mutateAsync
      .mockResolvedValueOnce(emailResult("proposal A", "image-a"))
      .mockResolvedValueOnce(emailResult("proposal B", "image-b"));
    mutations.preview.mutateAsync.mockResolvedValue({ subject: "preview", html: "html", text: "" });
    mutations.image.mutateAsync
      .mockReturnValueOnce(imageA.promise)
      .mockReturnValueOnce(imageB.promise);
    const props = emailProps({ entityId: "template-a", open: true });
    const view = render(<EmailAiSheet {...props} />);
    startEmailGeneration("request A");
    await screen.findByText("proposal A");
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));

    view.rerender(<EmailAiSheet {...props} entityId="template-b" purpose="marketing" />);
    startEmailGeneration("request B");
    await screen.findByText("proposal B");
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));

    await settle(imageA, generatedImage("asset-a", "stale image"));
    expect(screen.queryByAltText("stale image")).toBeNull();

    await settle(imageB, generatedImage("asset-b", "current image"));
    expect(await screen.findByAltText("current image")).toBeTruthy();
  });

  it.each([
    ["prompt", "画像プロンプト", "edited image prompt"],
    ["alt text", "代替テキスト", "edited image alt"],
  ])("rejects pending image success after editing the %s", async (_field, label, value) => {
    const pendingImage = deferred<GeneratedEmailImage>();
    mutations.generate.mutateAsync.mockResolvedValue(emailResult("proposal", "image-a"));
    mutations.preview.mutateAsync.mockResolvedValue({ subject: "preview", html: "html", text: "" });
    mutations.image.mutateAsync.mockReturnValue(pendingImage.promise);
    render(<EmailAiSheet {...emailProps()} />);
    startEmailGeneration("request with image");
    await screen.findByText("proposal");
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));

    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await settle(pendingImage, generatedImage("asset-stale", "stale old image"));

    expect(screen.queryByAltText("stale old image")).toBeNull();
    expect(applyButton().disabled).toBe(true);
  });

  it("rejects a pending image error after editing its request", async () => {
    const pendingImage = deferred<GeneratedEmailImage>();
    mutations.generate.mutateAsync.mockResolvedValue(emailResult("proposal", "image-a"));
    mutations.preview.mutateAsync.mockResolvedValue({ subject: "preview", html: "html", text: "" });
    mutations.image.mutateAsync.mockReturnValue(pendingImage.promise);
    render(<EmailAiSheet {...emailProps()} />);
    startEmailGeneration("request with image");
    await screen.findByText("proposal");
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));

    fireEvent.change(screen.getByLabelText("画像プロンプト"), {
      target: { value: "edited while pending" },
    });
    await reject(pendingImage, new Error("stale image failure"));

    expect(screen.queryByText("stale image failure")).toBeNull();
  });

  it("returns a current image failure to optional text-only apply even after editing", async () => {
    const pendingImage = deferred<GeneratedEmailImage>();
    const onApply = vi.fn<(proposal: EmailGenerationProposal) => void>();
    mutations.generate.mutateAsync.mockResolvedValue(emailResult("proposal", "image-a"));
    mutations.preview.mutateAsync.mockResolvedValue({ subject: "preview", html: "html", text: "" });
    mutations.image.mutateAsync.mockReturnValue(pendingImage.promise);
    render(<EmailAiSheet {...emailProps({ onApply })} />);
    startEmailGeneration("request with optional image");
    await screen.findByText("proposal");
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));

    await reject(pendingImage, new Error("current image failure"));

    expect(screen.getByText("current image failure")).toBeTruthy();
    expect(applyButton().disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("画像プロンプト"), {
      target: { value: "edited after failure" },
    });

    expect(applyButton().disabled).toBe(false);
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]?.[0].content.blocks).toEqual(defaultEmailDocumentV2().blocks);
  });

  it("clears an accepted image and disables apply when its request changes", async () => {
    mutations.generate.mutateAsync.mockResolvedValue(emailResult("proposal", "image-a"));
    mutations.preview.mutateAsync.mockResolvedValue({ subject: "preview", html: "html", text: "" });
    mutations.image.mutateAsync.mockResolvedValue(generatedImage("asset-a", "accepted image"));
    render(<EmailAiSheet {...emailProps()} />);
    startEmailGeneration("request with image");
    await screen.findByText("proposal");
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));
    await screen.findByAltText("accepted image");
    expect(applyButton().disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("代替テキスト"), {
      target: { value: "edited after generation" },
    });

    expect(screen.queryByAltText("accepted image")).toBeNull();
    expect(applyButton().disabled).toBe(true);
  });

  it("applies an image generated for the unchanged request fingerprint", async () => {
    const onApply = vi.fn<(proposal: EmailGenerationProposal) => void>();
    mutations.generate.mutateAsync.mockResolvedValue(emailResult("proposal", "image-a"));
    mutations.preview.mutateAsync.mockResolvedValue({ subject: "preview", html: "html", text: "" });
    mutations.image.mutateAsync.mockResolvedValue(generatedImage("asset-a", "accepted image"));
    render(<EmailAiSheet {...emailProps({ onApply })} />);
    startEmailGeneration("request with image");
    await screen.findByText("proposal");
    fireEvent.click(screen.getByRole("button", { name: "画像を生成" }));
    await screen.findByAltText("accepted image");

    fireEvent.click(applyButton());

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]?.[0].content.blocks[0]).toMatchObject({
      type: "image",
      source: { kind: "asset", assetId: "asset-a" },
    });
  });
});

function emailProps(
  overrides: Partial<Parameters<typeof EmailAiSheet>[0]> = {},
): Parameters<typeof EmailAiSheet>[0] {
  return {
    open: true,
    onOpenChange: vi.fn<(open: boolean) => void>(),
    mode: "refine",
    purpose: "transactional",
    entityId: "template-a",
    current: emailProposal("current"),
    onApply: vi.fn<(proposal: EmailGenerationProposal) => void>(),
    ...overrides,
  };
}

function startEmailGeneration(prompt: string): void {
  fireEvent.change(screen.getByLabelText("作りたいメール"), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "提案を生成" }));
}

function applyButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "この提案を下書きに適用",
  }) as HTMLButtonElement;
}

function emailProposal(name: string): EmailGenerationProposal {
  return { name, subject: `${name} subject`, content: defaultEmailDocumentV2() };
}

function emailResult(name: string, imageRequestId?: string): EmailGenerationResult {
  return {
    proposal: emailProposal(name),
    summary: `${name} summary`,
    assumptions: [],
    warnings: [],
    imageRequests: imageRequestId
      ? [
          {
            requestId: imageRequestId,
            afterBlockId: null,
            prompt: `${name} image prompt`,
            alt: `${name} image alt`,
          },
        ]
      : [],
  };
}

function generatedImage(assetId: string, alt: string): GeneratedEmailImage {
  return { assetId, alt, previewUrl: `/preview/${assetId}`, expiresAt: "2026-08-20T00:00:00.000Z" };
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
