// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApplyEmailSequenceResult,
  EmailSequenceGenerationResult,
  EmailSequenceProposal,
} from "@openengage/core/automations";
import { defaultEmailDocumentV2 } from "@openengage/core/messaging";

import { EmailSequenceAiSheet } from "./email-sequence-ai-sheet";

type MutationDouble = {
  mutateAsync: ReturnType<typeof vi.fn<(input: unknown) => Promise<unknown>>>;
  isPending: boolean;
};

const mutations = vi.hoisted(() => {
  const create = (): MutationDouble => ({
    mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>(),
    isPending: false,
  });
  return { generate: create(), apply: create(), preview: create() };
});

vi.mock("./automation-api", () => ({
  useGenerateEmailSequence: () => mutations.generate,
  useApplyEmailSequence: () => mutations.apply,
}));

vi.mock("@/features/emails/email-api", () => ({
  usePreviewEmailTemplate: () => mutations.preview,
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
    mutation.isPending = false;
  }
});

afterEach(cleanup);

describe("EmailSequenceAiSheet flow", () => {
  it("resolves required input, previews a ready proposal, and applies the accepted draft", async () => {
    const proposal = sequenceProposal();
    const applied: ApplyEmailSequenceResult = {
      automationId: "automation-created",
      draftVersionId: "version-created",
      templates: proposal.emails.map((email) => ({
        emailRef: email.emailRef,
        templateId: email.templateId,
      })),
      capabilityState: "transactional-compatible",
    };
    mutations.generate.mutateAsync
      .mockResolvedValueOnce(needsInput())
      .mockResolvedValueOnce({ status: "ready", proposal } satisfies EmailSequenceGenerationResult);
    mutations.preview.mutateAsync.mockImplementation(async (input) => ({
      subject: (input as { subject: string }).subject,
      html: `<p>${(input as { subject: string }).subject}</p>`,
      text: "preview",
    }));
    mutations.apply.mutateAsync.mockResolvedValue(applied);
    const onApplied = vi.fn<(result: ApplyEmailSequenceResult) => Promise<void>>(async () => {});
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <EmailSequenceAiSheet
        open
        onOpenChange={onOpenChange}
        onApplied={onApplied}
        entityId="new"
      />,
    );

    submitPrompt("Create onboarding sequence");
    expect(await screen.findByText("追加情報が必要です")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("選択してください"), {
      target: { value: "topic-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "選択内容で再生成" }));

    expect(await screen.findByText("Trial onboarding")).toBeTruthy();
    expect(mutations.generate.mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      mode: "create",
      continuation: needsInput().continuation,
      resolutions: [{ requestId: "topic", decision: "select", resourceId: "topic-1" }],
    });
    const applyButton = screen.getByRole("button", {
      name: "テンプレートとフローの下書きを作成",
    }) as HTMLButtonElement;
    await waitFor(() => expect(applyButton.disabled).toBe(false));
    fireEvent.click(applyButton);

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(applied));
    expect(mutations.apply.mutateAsync).toHaveBeenCalledWith(proposal);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores a deferred result from a previous close/open session", async () => {
    const oldGeneration = deferred<EmailSequenceGenerationResult>();
    mutations.generate.mutateAsync.mockReturnValueOnce(oldGeneration.promise);
    const props = {
      open: true,
      onOpenChange: vi.fn<(open: boolean) => void>(),
      onApplied: vi.fn<(result: ApplyEmailSequenceResult) => Promise<void>>(async () => {}),
      entityId: "sequence-a",
    };
    const view = render(<EmailSequenceAiSheet {...props} />);
    submitPrompt("Old request");

    view.rerender(<EmailSequenceAiSheet {...props} open={false} />);
    view.rerender(<EmailSequenceAiSheet {...props} open />);
    await settle(oldGeneration, needsInput("stale summary"));

    expect(screen.queryByText("stale summary")).toBeNull();
    expect(
      (screen.getByLabelText("実現したいライフサイクル施策") as HTMLTextAreaElement).value,
    ).toBe("");
  });
});

function submitPrompt(prompt: string): void {
  fireEvent.change(screen.getByLabelText("実現したいライフサイクル施策"), {
    target: { value: prompt },
  });
  fireEvent.click(screen.getByRole("button", { name: "提案を生成" }));
}

function needsInput(
  summary = "Choose a subscription topic",
): Extract<EmailSequenceGenerationResult, { status: "needs_input" }> {
  const request = {
    requestId: "topic",
    inputType: "resource" as const,
    kind: "subscription_topic" as const,
    label: "Subscription topic",
    reason: "Consent is required",
    required: true,
  };
  return {
    status: "needs_input",
    summary,
    plannedSteps: ["Resolve topic", "Build sequence"],
    continuation: {
      summary,
      plannedSteps: ["Resolve topic", "Build sequence"],
      requests: [request],
    },
    requests: [{ ...request, options: [{ id: "topic-1", name: "Product education" }] }],
  };
}

function sequenceProposal(): EmailSequenceProposal {
  const content = defaultEmailDocumentV2();
  const emails = ["welcome", "follow-up"].map((emailRef, index) => ({
    emailRef,
    templateId: `template-${index + 1}`,
    name: index === 0 ? "Welcome" : "Follow up",
    purpose: "transactional" as const,
    purposeDescription: "Service onboarding",
    subjectOptions: [index === 0 ? "Welcome" : "Next step"],
    selectedSubject: index === 0 ? "Welcome" : "Next step",
    content,
    cta: null,
    timing: index === 0 ? "Immediately" : "Tomorrow",
    recipientCondition: "Active",
    skipCondition: "Converted",
    variables: [],
    topicId: null,
    classificationReason: "Operational",
  }));
  return {
    proposalId: "proposal-1",
    automationId: "automation-1",
    summary: "Two email onboarding",
    overview: {
      name: "Trial onboarding",
      type: "onboarding",
      outcome: "Activate",
      audience: "Trials",
      entry: "Contact created",
      conversionExit: "Activated",
      cadence: "Now and tomorrow",
      reentry: "once",
      consent: "Service relationship",
      suppression: "Global suppression",
    },
    emails,
    definition: {
      name: "Trial onboarding",
      description: "Two email onboarding",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "contact_created", reentry: "once" },
        },
      ],
      edges: [],
    },
    capabilityState: "transactional-compatible",
    measurement: {
      primaryOutcome: "Activate",
      earlySignal: "Opened",
      baseline: "Unknown",
      target: "Unknown",
      firstMeasurementWindow: "30 days",
      events: ["email_opened"],
    },
    assumptions: [],
    warnings: [],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function settle<T>(pending: ReturnType<typeof deferred<T>>, value: T): Promise<void> {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}
