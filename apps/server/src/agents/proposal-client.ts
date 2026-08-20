import { createFlueClient, FlueApiError, FlueExecutionError } from "@flue/sdk";

import { uuidv7 } from "@openengage/database/shared";

import type { RuntimeEnv } from "../env";
import { isAbortError } from "../platform/abort";

const PROPOSAL_PART_NAME = "proposal";
const ABORT_CLEANUP_TIMEOUT_MS = 1_000;

export type AgentProposalFailure = "failed" | "timeout" | "unavailable";

export class AgentProposalError extends Error {
  public constructor(
    public readonly kind: AgentProposalFailure,
    options?: ErrorOptions,
  ) {
    super(`Agent proposal ${kind}`, options);
    this.name = "AgentProposalError";
  }
}

interface ProposalSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export interface AgentProposalEnv {
  AGENT_APP: Pick<RuntimeEnv["AGENT_APP"], "fetch">;
}

export interface AgentProposalTransport {
  run(input: { prompt: string; initialData: unknown; signal: AbortSignal }): Promise<unknown>;
  abort(signal?: AbortSignal): Promise<void>;
}

/**
 * Runs one structured Agent request through the internal service binding.
 * Domain services remain responsible for catalogs and semantic validation;
 * this helper owns transport, cancellation, proposal extraction, and parsing.
 */
export async function requestAgentProposal<T>(input: {
  env: AgentProposalEnv;
  agent: string;
  prompt: string;
  initialData: unknown;
  schema: ProposalSchema<T>;
  timeoutMs: number;
  abortCleanupTimeoutMs?: number | undefined;
  transport?: AgentProposalTransport | undefined;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timeout", "AbortError")),
    input.timeoutMs,
  );
  let transport = input.transport;

  try {
    transport ??= createAgentTransport(input.env, input.agent);
    const proposal = await raceWithAbort(
      transport.run({
        prompt: input.prompt,
        initialData: input.initialData,
        signal: controller.signal,
      }),
      controller.signal,
    );
    controller.signal.throwIfAborted();
    const parsed = input.schema.safeParse(proposal);
    if (!parsed.success) {
      throw new AgentProposalError("failed", { cause: parsed.error });
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AgentProposalError) throw error;
    if (controller.signal.aborted || isAbortError(error)) {
      if (transport) {
        await abortTransport(transport, input.abortCleanupTimeoutMs ?? ABORT_CLEANUP_TIMEOUT_MS);
      }
      throw new AgentProposalError("timeout", { cause: error });
    }
    if (error instanceof FlueExecutionError) {
      if (isDurableSubmissionTimeout(error)) {
        throw new AgentProposalError("timeout", { cause: error });
      }
      throw new AgentProposalError("failed", { cause: error });
    }
    if (error instanceof FlueApiError) {
      throw new AgentProposalError("unavailable", { cause: error });
    }
    throw new AgentProposalError("unavailable", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function createAgentTransport(env: AgentProposalEnv, agent: string): AgentProposalTransport {
  const conversation = createFlueClient({
    url: `https://agent.internal/internal/${agent}/${uuidv7()}`,
    fetch: (request, init) => env.AGENT_APP.fetch(new Request(request, init)),
  });
  return {
    async run(input) {
      const admission = await conversation.send({
        message: { kind: "user", body: input.prompt },
        initialData: input.initialData,
        uid: null,
        signal: input.signal,
      });
      const reply = await conversation.read(admission, { signal: input.signal });
      return extractLatestProposal(reply.data);
    },
    async abort(signal) {
      await conversation.abort(signal ? { signal } : undefined);
    },
  };
}

export function extractLatestProposal(
  data: Record<string, readonly unknown[] | undefined>,
): unknown {
  return data[PROPOSAL_PART_NAME]?.at(-1);
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(signal.reason ?? new DOMException("Aborted", "AbortError"));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function abortTransport(transport: AgentProposalTransport, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort(new DOMException("Abort cleanup timeout", "AbortError"));
      resolve();
    }, timeoutMs);
  });
  const abort = Promise.resolve()
    .then(() => transport.abort(controller.signal))
    .catch(() => undefined);
  try {
    await Promise.race([abort, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isDurableSubmissionTimeout(error: FlueExecutionError): boolean {
  return (
    error.failure === "failed" && isRecord(error.error) && error.error.type === "submission_timeout"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
