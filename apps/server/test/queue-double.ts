/**
 * A Queue test double driven by the handlers a test passes; the methods a
 * test leaves out succeed without recording anything.
 */
export function queueDouble(
  handlers: {
    send?: (body: unknown) => Promise<unknown>;
    sendBatch?: (messages: Iterable<MessageSendRequest<unknown>>) => Promise<unknown>;
  } = {},
): Queue {
  return {
    send: handlers.send ?? (async () => undefined),
    sendBatch: handlers.sendBatch ?? (async () => undefined),
    metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }),
  } as unknown as Queue;
}
