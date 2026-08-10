import { useCallback, useEffect, useRef, useState } from "react";

export type AiProposalWorkflowResource = "segment" | "automation" | "email-sequence";

export function createAiProposalWorkflowKey(input: {
  resource: AiProposalWorkflowResource;
  mode: "create" | "refine";
  entityId?: string | undefined;
  projectId?: string | undefined;
  briefRevision?: number | undefined;
}): string {
  return [
    input.resource,
    input.mode,
    input.entityId ?? "new",
    input.projectId ?? "standalone",
    input.briefRevision?.toString() ?? "none",
  ].join(":");
}

type WorkflowToken = { key: string; requestId: number };

/**
 * Owns the identity of an AI proposal. Responses from a closed sheet or a previous
 * entity/revision are ignored, and only the matching proposal can be applied.
 */
export function useAiProposalWorkflow({
  open,
  workflowKey,
  onReset,
}: {
  open: boolean;
  workflowKey: string;
  onReset: () => void;
}) {
  const live = useRef({ open, workflowKey });
  live.current = { open, workflowKey };
  const resetCallback = useRef(onReset);
  resetCallback.current = onReset;
  const latestRequestId = useRef(0);
  const [proposalKey, setProposalKey] = useState<string | null>(null);

  const reset = useCallback(() => {
    latestRequestId.current += 1;
    setProposalKey(null);
    resetCallback.current();
  }, []);

  useEffect(() => reset(), [open, reset, workflowKey]);
  useEffect(
    () => () => {
      latestRequestId.current += 1;
      live.current = { ...live.current, open: false };
    },
    [],
  );

  const beginRequest = useCallback((): WorkflowToken => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    return { key: live.current.workflowKey, requestId };
  }, []);

  const isCurrentResponse = useCallback((token: WorkflowToken): boolean => {
    const current = live.current;
    return !(
      !current.open ||
      current.workflowKey !== token.key ||
      latestRequestId.current !== token.requestId
    );
  }, []);

  const acceptResponse = useCallback(
    (token: WorkflowToken, commit: () => void): boolean => {
      if (!isCurrentResponse(token)) return false;
      commit();
      setProposalKey(token.key);
      return true;
    },
    [isCurrentResponse],
  );

  return {
    beginRequest,
    isCurrentResponse,
    acceptResponse,
    reset,
    canApply: open && proposalKey === workflowKey,
  };
}
