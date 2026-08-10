// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { emptyBrief, type ProjectBriefFormDraft } from "./draft";
import { ProjectBriefForm } from "./form";

afterEach(cleanup);

describe("ProjectBriefForm", () => {
  it("allows the local review datetime to be cleared without parsing during input", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [draft, setDraft] = useState<ProjectBriefFormDraft>(emptyBrief());
      return <ProjectBriefForm value={draft} members={[]} onChange={setDraft} />;
    }
    render(<Harness />);

    const reviewAt = screen.getByLabelText("レビュー日時") as HTMLInputElement;
    await user.clear(reviewAt);

    expect(reviewAt.value).toBe("");
  });
});
