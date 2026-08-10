import { useAgentFinish, useDataWriter, usePersistentState, useTool } from "@flue/runtime";
import * as v from "valibot";

interface ProposalSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export function useStructuredProposalSubmission<T>(options: {
  toolName: string;
  description: string;
  schema: ProposalSchema<T>;
  schemaErrorLabel: string;
  validate?: ((proposal: T) => string | null) | undefined;
  retryLimitError: string;
  retrySignal: { type: string; body: string };
  maxRetries?: number | undefined;
}): void {
  const writeProposal = useDataWriter("proposal");
  const [finishRetries, setFinishRetries] = usePersistentState("proposal-finish-retries", 0);
  const maximum = options.maxRetries ?? 3;

  useTool({
    name: options.toolName,
    description: options.description,
    input: v.object({ proposal: v.unknown() }),
    run({ data }) {
      const parsed = options.schema.safeParse(data.proposal);
      if (!parsed.success) {
        throw new Error(`${options.schemaErrorLabel}: ${errorMessage(parsed.error)}`);
      }
      const validationIssue = options.validate?.(parsed.data) ?? null;
      if (validationIssue) {
        throw new Error(validationIssue);
      }
      writeProposal(parsed.data);
      return { output: { accepted: true }, terminate: true };
    },
  });

  useAgentFinish(({ response, append }) => {
    const submitted = response.toolCalls.some(
      (call) => call.tool === options.toolName && !call.isError,
    );
    if (submitted) return;
    const retry = nextProposalRetry(finishRetries, maximum);
    if (!retry.allowed) throw new Error(options.retryLimitError);
    setFinishRetries(retry.count);
    append({ kind: "signal", ...options.retrySignal });
  });
}

export function nextProposalRetry(
  completedRetries: number,
  maximumRetries: number,
): { allowed: true; count: number } | { allowed: false; count: number } {
  if (completedRetries >= maximumRetries) {
    return { allowed: false, count: completedRetries };
  }
  return { allowed: true, count: completedRetries + 1 };
}

/** Escapes the two characters that could terminate the XML-like context boundary. */
export function serializeTrustedContext(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
