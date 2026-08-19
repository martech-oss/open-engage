// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectResourceType } from "@openengage/core/projects";

import { LinkProjectResourceDialog } from "./project-brief-detail-dialogs";

afterEach(cleanup);

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
