import { useCallback, useEffect, useRef, useState } from "react";

type SerializedValue =
  | ["undefined" | "null"]
  | ["string" | "boolean" | "number" | "bigint", string]
  | ["array", SerializedValue[]]
  | ["object", Array<[string, SerializedValue]>];

/** Stable, tuple-boundary-preserving identity for any AI request inputs. */
export function createAiProposalWorkflowKey(parts: readonly unknown[]): string {
  return JSON.stringify(["tuple", parts.map(serializeValue)]);
}

function serializeValue(value: unknown): SerializedValue {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", String(value)];
  if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : String(value)];
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (Array.isArray(value)) return ["array", value.map(serializeValue)];
  if (typeof value === "object") {
    return [
      "object",
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, serializeValue(entry)]),
    ];
  }
  throw new TypeError(`AI request keys must be JSON-serializable; received ${typeof value}`);
}

type WorkflowToken = {
  requestKey: string;
  session: number;
  request: symbol;
};

type WorkflowIdentity = {
  open: boolean;
  requestKey: string;
  session: number;
};

/**
 * Logical request authority for AI proposals. Provider work may still finish,
 * but stale callbacks lose permission to touch the current UI.
 */
export function useAiProposalWorkflow({
  open,
  requestKey,
  onReset,
}: {
  open: boolean;
  requestKey: string;
  onReset: () => void;
}) {
  const identity = useRef<WorkflowIdentity>({ open, requestKey, session: 0 });
  const latestRequest = useRef<WorkflowToken | null>(null);
  const mounted = useRef(true);
  const resetCallback = useRef(onReset);
  resetCallback.current = onReset;
  const [accepted, setAccepted] = useState<{ requestKey: string; session: number } | null>(null);

  if (identity.current.open !== open || identity.current.requestKey !== requestKey) {
    identity.current = { open, requestKey, session: identity.current.session + 1 };
    latestRequest.current = null;
  }

  useEffect(() => {
    setAccepted(null);
    resetCallback.current();
  }, [open, requestKey]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latestRequest.current = null;
    };
  }, []);

  const beginRequest = useCallback((): WorkflowToken => {
    const current = identity.current;
    const token = {
      requestKey: current.requestKey,
      session: current.session,
      request: Symbol("ai-request"),
    };
    latestRequest.current = token;
    return token;
  }, []);

  const isCurrent = useCallback((token: WorkflowToken): boolean => {
    const current = identity.current;
    return Boolean(
      mounted.current &&
      current.open &&
      token.requestKey === current.requestKey &&
      token.session === current.session &&
      latestRequest.current?.request === token.request,
    );
  }, []);

  const acceptCurrent = useCallback(
    (token: WorkflowToken, commit: () => void): boolean => {
      if (!isCurrent(token)) return false;
      commit();
      return true;
    },
    [isCurrent],
  );

  const acceptProposal = useCallback(
    (token: WorkflowToken, commit: () => void): boolean => {
      if (!isCurrent(token)) return false;
      commit();
      setAccepted({ requestKey: token.requestKey, session: token.session });
      return true;
    },
    [isCurrent],
  );

  const reset = useCallback(() => {
    identity.current = { ...identity.current, session: identity.current.session + 1 };
    latestRequest.current = null;
    setAccepted(null);
    resetCallback.current();
  }, []);

  const current = identity.current;
  return {
    beginRequest,
    isCurrent,
    acceptCurrent,
    acceptProposal,
    reset,
    canApply:
      open && accepted?.requestKey === current.requestKey && accepted.session === current.session,
  };
}
