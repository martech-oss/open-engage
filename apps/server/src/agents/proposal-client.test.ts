import { FlueApiError, FlueExecutionError } from "@flue/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

import type { AgentDefinition } from "@openengage/core/agents";

import type { AiGenerationError } from "./generation-error";
import {
  type AgentProposalEnv,
  type AgentProposalTransport,
  extractLatestProposal,
  requestAgentProposal,
} from "./proposal-client";

const transport = {
  run: vi.fn<AgentProposalTransport["run"]>(),
  abort: vi.fn<AgentProposalTransport["abort"]>(),
} satisfies AgentProposalTransport;

const env = {
  AGENT_APP: { fetch: vi.fn<typeof fetch>() },
} satisfies AgentProposalEnv;

const testAgent = {
  name: "test-agent",
  initialData: z.unknown(),
  result: z.unknown(),
  agentTimeoutMs: 1_000,
  serverTimeoutMs: 1_000,
} satisfies AgentDefinition;

describe("requestAgentProposal", () => {
  beforeEach(() => {
    transport.run.mockReset().mockResolvedValue({ value: 42 });
    transport.abort.mockReset().mockResolvedValue(undefined);
  });

  it("returns a schema-validated proposal", async () => {
    await expect(
      requestAgentProposal({
        env,
        agent: testAgent,
        prompt: "design",
        initialData: { trusted: true },
        transport,
      }),
    ).resolves.toEqual({ value: 42 });
  });

  it("classifies invalid structured output as failed", async () => {
    await expect(
      requestAgentProposal({
        env,
        agent: { ...testAgent, result: z.object({ value: z.string() }) },
        prompt: "design",
        initialData: {},
        transport,
      }),
    ).rejects.toMatchObject({ kind: "failed" } satisfies Partial<AiGenerationError>);
  });

  it.each([
    [new FlueApiError(503, {}), "unavailable"],
    [
      new FlueExecutionError({
        target: "agent_submission",
        targetId: "submission-id",
        failure: "failed",
      }),
      "failed",
    ],
    [
      new FlueExecutionError({
        target: "agent_submission",
        targetId: "submission-id",
        failure: "failed",
        error: { type: "submission_timeout", message: "durability deadline exceeded" },
      }),
      "timeout",
    ],
  ] as const)("maps transport failures", async (failure, kind) => {
    transport.run.mockRejectedValueOnce(failure);

    await expect(
      requestAgentProposal({
        env,
        agent: testAgent,
        prompt: "design",
        initialData: {},
        transport,
      }),
    ).rejects.toMatchObject({ kind });
  });

  it("aborts the conversation when the deadline expires", async () => {
    transport.run.mockImplementationOnce(
      (options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
        }),
    );

    await expect(
      requestAgentProposal({
        env,
        agent: { ...testAgent, serverTimeoutMs: 1 },
        prompt: "design",
        initialData: {},
        transport,
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(transport.abort).toHaveBeenCalledOnce();
  });

  it("does not let a hung durable abort defeat the request deadline", async () => {
    transport.run.mockImplementationOnce(
      (options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
        }),
    );
    transport.abort.mockImplementationOnce(() => new Promise(() => undefined));

    await expect(
      requestAgentProposal({
        env,
        agent: { ...testAgent, serverTimeoutMs: 1 },
        prompt: "design",
        initialData: {},
        abortCleanupTimeoutMs: 2,
        transport,
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("enforces the deadline even when the transport ignores the signal forever", async () => {
    transport.run.mockImplementationOnce(() => new Promise(() => undefined));

    await expect(
      requestAgentProposal({
        env,
        agent: { ...testAgent, serverTimeoutMs: 1 },
        prompt: "design",
        initialData: {},
        abortCleanupTimeoutMs: 2,
        transport,
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(transport.abort).toHaveBeenCalledOnce();
  });

  it("rejects a signal-ignoring transport that resolves after the deadline", async () => {
    transport.run.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ value: 42 }), 5)),
    );

    await expect(
      requestAgentProposal({
        env,
        agent: { ...testAgent, serverTimeoutMs: 1 },
        prompt: "design",
        initialData: {},
        abortCleanupTimeoutMs: 2,
        transport,
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(transport.abort).toHaveBeenCalledOnce();
  });
});

describe("extractLatestProposal", () => {
  it("returns the last proposal part and ignores other named streams", () => {
    expect(
      extractLatestProposal({ proposal: [{ revision: 1 }, { revision: 2 }], trace: ["ignored"] }),
    ).toEqual({ revision: 2 });
  });

  it("returns undefined when the agent emitted no proposal", () => {
    expect(extractLatestProposal({ trace: ["no proposal"] })).toBeUndefined();
  });
});
