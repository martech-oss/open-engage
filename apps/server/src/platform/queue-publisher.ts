/** The JSON messages produced by this application, without consumer/admin capabilities. */
export interface QueuePublisher<T> {
  sendBatch(messages: Iterable<MessageSendRequest<T>>): Promise<unknown>;
}

/** Validate before publishing, then respect both Cloudflare Queue batch limits. */
export async function publishQueueBatches<T>(
  queue: QueuePublisher<T>,
  messages: readonly { body: T }[],
  onPublished?: (count: number) => void,
): Promise<void> {
  const encoder = new TextEncoder();
  const sizes = messages.map(({ body }) => {
    const json = JSON.stringify(body);
    if (json === undefined) throw new TypeError("Queue message must be JSON serializable");
    // Reserve the documented internal metadata allowance as well as UTF-8 payload bytes.
    const size = encoder.encode(json).byteLength + 100;
    if (size > 128_000) throw new RangeError("Queue message exceeds 128KB");
    return size;
  });
  let start = 0;
  while (start < messages.length) {
    let end = start,
      bytes = 0;
    while (end < messages.length && end - start < 100 && bytes + sizes[end]! <= 256_000) {
      bytes += sizes[end]!;
      end++;
    }
    await queue.sendBatch(
      messages.slice(start, end).map((message) => ({ ...message, contentType: "json" as const })),
    );
    onPublished?.(end - start);
    start = end;
  }
}
