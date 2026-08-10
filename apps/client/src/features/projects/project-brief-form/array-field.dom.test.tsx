// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArrayField } from "./array-field";

afterEach(cleanup);

describe("ArrayField", () => {
  it("edits one item at a time and exposes add/reorder/remove controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: string[]) => void>();
    const { rerender } = render(
      <ArrayField
        name="definition.actions"
        label="アクション"
        value={["メール", "待機"]}
        disabled={false}
        errors={{}}
        minItems={1}
        maxItems={3}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "アクション 2を上へ移動" }));
    expect(onChange).toHaveBeenLastCalledWith(["待機", "メール"]);

    rerender(
      <ArrayField
        name="definition.actions"
        label="アクション"
        value={["待機", "メール"]}
        disabled={false}
        errors={{}}
        minItems={1}
        maxItems={3}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(onChange).toHaveBeenLastCalledWith(["待機", "メール", ""]);
    await user.click(screen.getByRole("button", { name: "アクション 1を削除" }));
    expect(onChange).toHaveBeenLastCalledWith(["メール"]);
  });
});
