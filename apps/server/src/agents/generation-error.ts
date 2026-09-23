export type AiGenerationFailure = "failed" | "timeout" | "unavailable";

/**
 * An AI generation that produced nothing usable: the Agent failed, timed out
 * or could not be reached, or its proposal failed domain validation.
 */
export class AiGenerationError extends Error {
  public constructor(
    public readonly kind: AiGenerationFailure,
    options?: ErrorOptions,
  ) {
    super(`AI generation ${kind}`, options);
    this.name = "AiGenerationError";
  }
}

type ProcedureErrorFactories = Record<AiGenerationFailure, () => Error>;

/** The shared AI_GENERATION_* contract errors most generation procedures declare. */
export function aiGenerationProcedureErrors(errors: {
  AI_GENERATION_FAILED: () => Error;
  AI_GENERATION_TIMEOUT: () => Error;
  AI_GENERATION_UNAVAILABLE: () => Error;
}): ProcedureErrorFactories {
  return {
    failed: () => errors.AI_GENERATION_FAILED(),
    timeout: () => errors.AI_GENERATION_TIMEOUT(),
    unavailable: () => errors.AI_GENERATION_UNAVAILABLE(),
  };
}

/** Rethrows an AiGenerationError as the procedure's typed error; anything else unchanged. */
export function rethrowAiGenerationError(
  error: unknown,
  toProcedureError: ProcedureErrorFactories,
): never {
  if (error instanceof AiGenerationError) throw toProcedureError[error.kind]();
  throw error;
}
