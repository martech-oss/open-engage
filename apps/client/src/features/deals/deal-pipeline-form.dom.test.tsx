// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DealPipelineForm } from "./deal-pipeline-form";

vi.mock("./deal-api", () => ({
  useArchiveDealPipeline: () => ({ mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>() }),
  useCreateDealPipeline: () => ({ mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>() }),
  useUpdateDealPipeline: () => ({ mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>() }),
}));

afterEach(cleanup);

describe("DealPipelineForm", () => {
  it("keeps the current default checked and explains how to change it", () => {
    render(
      <DealPipelineForm
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        pipeline={{
          id: "default-pipeline",
          name: "Sales",
          isDefault: true,
          stages: [{ id: "stage", name: "New", color: "#64748b", position: 0, probability: 10 }],
        }}
        sourcePipeline={null}
        canArchive
        onCreated={vi.fn<(pipelineId: string) => Promise<void>>()}
        onArchived={vi.fn<() => Promise<void>>()}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "デフォルトのパイプラインにする",
    });
    expect(checkbox.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("別のパイプラインをデフォルトにすると変更できます。")).toBeTruthy();
  });
});
