// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProjectResourceType } from "@openengage/core/projects";

import {
  LinkProjectResourceDialog,
  ReviewProjectBriefDialog,
} from "./project-brief-detail-dialogs";

describe("LinkProjectResourceDialog", () => {
  it("offers every supported project resource type including redirects", () => {
    render(
      <LinkProjectResourceDialog
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onSubmit={vi.fn<(resourceType: ProjectResourceType, resourceId: string) => Promise<void>>()}
      />,
    );

    const selector = screen.getByLabelText("リソース種別") as unknown as HTMLSelectElement;
    expect(Array.from(selector.options, (option) => [option.value, option.text])).toEqual([
      ["automation", "Automation"],
      ["email_sequence", "Email sequence"],
      ["segment", "Segment"],
      ["form", "Form"],
      ["landing_page", "Landing page"],
      ["redirect", "Redirect"],
    ]);
  });
});

describe("ReviewProjectBriefDialog", () => {
  it("refuses to approve once the brief has changed since the dialog opened", () => {
    const onSubmit = vi.fn<(comment: string) => Promise<void>>().mockResolvedValue(undefined);
    const { rerender } = render(
      <ReviewProjectBriefDialog
        kind="approve"
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onSubmit={onSubmit}
      />,
    );
    const approve = screen.getByRole("button", { name: "承認" }) as unknown as HTMLButtonElement;
    expect(approve.disabled).toBe(false);

    rerender(
      <ReviewProjectBriefDialog
        kind="approve"
        stale
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText(/施策ブリーフが更新されました/)).toBeTruthy();
    expect(approve.disabled).toBe(true);
    fireEvent.submit(approve.closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
