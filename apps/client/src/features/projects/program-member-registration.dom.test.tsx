// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PROJECT_PROGRAM_TEMPLATES, type ProjectProgram } from "@openengage/core/projects";
const submit = vi.hoisted(() =>
  vi
    .fn<(input: { idempotencyKey: string }) => Promise<{ jobId: string }>>()
    .mockResolvedValue({ jobId: "job-accepted" }),
);
const invalidate = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
vi.mock("./program-api", () => ({
  useProgramInvalidator: () => invalidate,
  useImportProjectMembers: () => ({ mutateAsync: submit, isPending: false }),
  useMutateProjectMember: () => ({ mutateAsync: vi.fn<() => Promise<void>>(), isPending: false }),
  programMemberImportQueryOptions: (id: string, jobId: string) => ({
    queryKey: ["import", id, jobId],
    queryFn: async () => ({
      jobId,
      status: "completed",
      total: 2,
      processed: 2,
      rows: [
        { row: 2, ok: true },
        { row: 3, ok: false, error: "Unknown contact" },
      ],
    }),
  }),
}));
vi.mock("@/features/contacts/contact-api", () => ({
  contactSearchDefaults: {},
  contactsQueryOptions: () => ({ queryKey: ["contacts"], queryFn: async () => ({ items: [] }) }),
}));
import { ProgramMemberRegistration } from "./program-member-registration";
afterEach(() => {
  cleanup();
  submit.mockClear();
});
it("shows accepted job progress and row errors and keeps the request key on retries", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProgramMemberRegistration
        id="project"
        program={{ publishedDefinition: PROJECT_PROGRAM_TEMPLATES.event } as ProjectProgram}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("CSV内容"), {
    target: { value: "contactId\nknown\nunknown" },
  });
  fireEvent.click(screen.getByRole("button", { name: "CSVを取り込む" }));
  await screen.findByText("3行目: Unknown contact");
  expect(screen.getByText(/CSV受付済み:/).textContent).toContain("job-accepted");
  expect(screen.getByText(/CSV受付済み:/).textContent).toContain("2 / 2行");
  fireEvent.click(screen.getByRole("button", { name: "CSVを取り込む" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[0]![0].idempotencyKey).toBe(submit.mock.calls[1]![0].idempotencyKey);
  fireEvent.change(screen.getByLabelText("CSV内容"), { target: { value: "contactId\nchanged" } });
  fireEvent.click(screen.getByRole("button", { name: "CSVを取り込む" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
  expect(submit.mock.calls[2]![0].idempotencyKey).not.toBe(submit.mock.calls[0]![0].idempotencyKey);
});
