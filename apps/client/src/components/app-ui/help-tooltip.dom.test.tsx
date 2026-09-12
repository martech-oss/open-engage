// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import { HelpTooltip } from "./help-tooltip";

afterEach(cleanup);

it("keeps explanations hidden until keyboard focus and closes with Escape without moving focus", async () => {
  const user = userEvent.setup();
  render(<HelpTooltip label="CTOR">クリック数 ÷ 開封数</HelpTooltip>);
  expect(screen.queryByText("クリック数 ÷ 開封数")).toBeNull();
  await user.tab();
  expect((await screen.findByRole("tooltip")).textContent).toContain("クリック数 ÷ 開封数");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "CTORの説明" }));
});

it("opens on hover and touch, closes outside, and never submits its parent form", async () => {
  const user = userEvent.setup();
  let submissions = 0;
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submissions++;
      }}
    >
      <HelpTooltip label="ROI">費用が0の場合は —</HelpTooltip>
      <button type="button">次へ</button>
    </form>,
  );
  const trigger = screen.getByRole("button", { name: "ROIの説明" });
  await user.hover(trigger);
  await screen.findByRole("tooltip");
  await user.unhover(trigger);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  await user.pointer([{ keys: "[TouchA>]", target: trigger }, { keys: "[/TouchA]" }]);
  await screen.findByRole("tooltip");
  await user.click(screen.getByRole("button", { name: "次へ" }));
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  expect(submissions).toBe(0);
});
