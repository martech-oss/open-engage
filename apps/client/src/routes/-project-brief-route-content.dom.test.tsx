// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/projects/project-brief-pages", () => ({
  ProjectBriefDetailPage: ({ id }: { id: string }) => {
    const [draft, setDraft] = useState("");
    return (
      <label>
        {id}
        <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
    );
  },
}));

import { ProjectBriefRouteContent } from "./_app.automations.briefs.$id";

afterEach(cleanup);

describe("ProjectBriefRouteContent", () => {
  it("remounts brief-local dialog and draft state when the route id changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProjectBriefRouteContent id="brief-a" />);

    await user.type(screen.getByRole("textbox"), "unsaved brief A");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("unsaved brief A");

    rerender(<ProjectBriefRouteContent id="brief-b" />);

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("brief-b")).toBeTruthy();
  });
});
