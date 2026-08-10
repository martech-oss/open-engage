import { createFlueClient, FlueApiError, FlueExecutionError } from "@flue/sdk";

import {
  segmentGenerationAgentResultSchema,
  type GenerateSegmentInput,
  type SegmentGenerationCatalog,
  type SegmentGenerationContinuation,
  type SegmentGenerationResult,
  type SegmentResourceRequest,
} from "@openengage/core/segments";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase, uuidv7 } from "@openengage/database";

import type { RuntimeEnv } from "../env";
import { previewSegment } from "./list-service";
import { loadSegmentCatalog, optionsForKind, validateSegmentFilter } from "./validation-service";

const GENERATION_TIMEOUT_MS = 60_000;
const PROPOSAL_PART_NAME = "proposal";

export type SegmentGenerationFailure = "failed" | "timeout" | "unavailable";

export class SegmentGenerationError extends Error {
  public constructor(
    public readonly kind: SegmentGenerationFailure,
    options?: ErrorOptions,
  ) {
    super(`Segment generation ${kind}`, options);
    this.name = "SegmentGenerationError";
  }
}

export async function generateSegment(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  input: GenerateSegmentInput,
  trustedBrief?: unknown,
): Promise<SegmentGenerationResult> {
  const catalog = await loadSegmentCatalog(database, workspace);
  const unresolved = unresolvedContinuation(input, catalog);
  if (unresolved) return unresolved;
  const proposal = await requestSegmentProposal(env, input, catalog, trustedBrief);
  if (proposal.status === "needs_input") {
    return needsInputResult(
      {
        summary: proposal.summary,
        plannedLogic: proposal.plannedLogic,
        resources: proposal.resources,
      },
      catalog,
    );
  }
  if (proposal.definition.kind === "static") {
    return { ...proposal, preview: { matchedCount: 0, capped: false } };
  }
  const validation = await validateSegmentFilter(
    database,
    workspace,
    proposal.definition.filter,
    catalog,
  );
  if (!validation.valid) {
    throw new SegmentGenerationError("failed", {
      cause: new Error(validation.issues.map((issue) => issue.message).join("; ")),
    });
  }
  const preview = await previewSegment(database, workspace, validation.normalized);
  return {
    ...proposal,
    definition: { ...proposal.definition, filter: validation.normalized },
    preview: { matchedCount: preview.matchedCount, capped: preview.capped },
  };
}

async function requestSegmentProposal(
  env: RuntimeEnv,
  request: GenerateSegmentInput,
  catalog: SegmentGenerationCatalog,
  trustedBrief?: unknown,
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timeout", "AbortError")),
    GENERATION_TIMEOUT_MS,
  );
  const conversation = createFlueClient({
    url: `https://agent.internal/internal/segment-designer/${uuidv7()}`,
    fetch: (input, init) => env.AGENT_APP.fetch(new Request(input, init)),
  });
  try {
    const admission = await conversation.send({
      message: { kind: "user", body: request.prompt },
      initialData: { request, catalog, ...(trustedBrief ? { trustedBrief } : {}) },
      uid: null,
      signal: controller.signal,
    });
    const reply = await conversation.read(admission, { signal: controller.signal });
    const proposal = reply.data[PROPOSAL_PART_NAME]?.at(-1);
    const parsed = segmentGenerationAgentResultSchema.safeParse(proposal);
    if (!parsed.success) throw new SegmentGenerationError("failed", { cause: parsed.error });
    return parsed.data;
  } catch (error) {
    if (error instanceof SegmentGenerationError) throw error;
    if (controller.signal.aborted || isAbortError(error)) {
      await conversation.abort().catch(() => undefined);
      throw new SegmentGenerationError("timeout", { cause: error });
    }
    if (error instanceof FlueApiError) {
      throw new SegmentGenerationError("unavailable", { cause: error });
    }
    if (error instanceof FlueExecutionError) {
      throw new SegmentGenerationError("failed", { cause: error });
    }
    throw new SegmentGenerationError("unavailable", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function unresolvedContinuation(
  input: GenerateSegmentInput,
  catalog: SegmentGenerationCatalog,
): SegmentGenerationResult | null {
  if (!input.continuation) return null;
  const resolutions = new Map(input.resolutions?.map((item) => [item.requestId, item]) ?? []);
  const unresolved = input.continuation.resources.filter((request) => {
    const resolution = resolutions.get(request.requestId);
    return (
      !resolution ||
      !optionsForKind(catalog, request.kind).some((option) => option.id === resolution.resourceId)
    );
  });
  return unresolved.length > 0 ? needsInputResult(input.continuation, catalog) : null;
}

function needsInputResult(
  continuation: SegmentGenerationContinuation,
  catalog: SegmentGenerationCatalog,
): SegmentGenerationResult {
  assertUniqueRequests(continuation.resources);
  return {
    status: "needs_input",
    summary: continuation.summary,
    plannedLogic: continuation.plannedLogic,
    continuation,
    resources: continuation.resources.map((request) => ({
      ...request,
      options: optionsForKind(catalog, request.kind),
    })),
  };
}

function assertUniqueRequests(requests: SegmentResourceRequest[]): void {
  const ids = new Set<string>();
  for (const request of requests) {
    if (ids.has(request.requestId)) {
      throw new SegmentGenerationError("failed", {
        cause: new Error(`Duplicate resource request: ${request.requestId}`),
      });
    }
    ids.add(request.requestId);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
