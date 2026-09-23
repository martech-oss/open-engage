// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { search } = vi.hoisted(() => ({
  search: vi.fn<(query: string) => Promise<unknown>>(),
}));

vi.mock("./contact-api", () => ({
  CONTACT_PICKER_LIMIT: 2,
  contactPickerQueryOptions: (query: string) => ({
    queryKey: ["contact-picker", query],
    queryFn: () => search(query),
  }),
}));

import { ContactPickerField } from "./contact-picker";

function contact(id: string, email: string) {
  return { id, email, firstName: null, lastName: null };
}

describe("ContactPickerField", () => {
  it("searches on the server and hides contacts that are already attached", async () => {
    search.mockImplementation(async (query) =>
      query === "late"
        ? { items: [contact("c-150", "late@example.com")], total: 1 }
        : {
            items: [contact("c-1", "first@example.com"), contact("c-2", "second@example.com")],
            total: 150,
          },
    );
    const user = userEvent.setup();
    renderWithQueryClient(<ContactPickerField excludeIds={new Set(["c-1"])} />);

    const select = await screen.findByRole("combobox", { name: "連絡先" });
    await waitFor(() => expect(select.hasAttribute("disabled")).toBe(false));
    expect(optionLabels(select)).toEqual(["選択してください", "second@example.com"]);
    expect(screen.getByText("上位2件を表示しています。検索で絞り込めます。")).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: "連絡先を検索" }), "late");

    await waitFor(() =>
      expect(optionLabels(select)).toEqual(["選択してください", "late@example.com"]),
    );
    expect(search).toHaveBeenLastCalledWith("late");
  });

  it("explains an empty result instead of offering nothing silently", async () => {
    search.mockResolvedValue({ items: [contact("c-1", "member@example.com")], total: 1 });
    renderWithQueryClient(<ContactPickerField excludeIds={new Set(["c-1"])} />);

    expect(
      await screen.findByText("追加できる連絡先が見つかりません。検索語を変えてください。"),
    ).toBeTruthy();
  });
});

function optionLabels(select: HTMLElement): string[] {
  return Array.from(select.querySelectorAll("option"), (option) => option.textContent ?? "");
}

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}
