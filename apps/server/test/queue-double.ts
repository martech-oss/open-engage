/**
 * A Queue test double driven by the handlers a test passes; the methods a
 * test leaves out succeed without recording anything.
 */
export function queueDouble(
  handlers: {
    send?: (body: unknown) => Promise<unknown>;
    sendBatch?: (messages: MessageSendRequest<unknown>[]) => Promise<unknown>;
  } = {},
): Queue {
  const { send, sendBatch } = handlers;
  return {
    send: send ?? (async () => undefined),
    sendBatch: sendBatch
      ? (messages: Iterable<MessageSendRequest<unknown>>) => sendBatch(Array.from(messages))
      : async () => undefined,
    metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }),
  } as unknown as Queue;
}

/** A queue that appends every published body to `published`, optionally pausing before batches. */
export function recordingQueue(
  published: unknown[],
  options: { beforeBatch?: () => Promise<void> } = {},
): Queue {
  return queueDouble({
    send: async (body) => {
      published.push(body);
    },
    sendBatch: async (messages) => {
      await options.beforeBatch?.();
      published.push(...messages.map((message) => message.body));
    },
  });
}
