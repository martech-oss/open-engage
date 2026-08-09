export async function enqueueSegmentContactReconciliation(
  queue: Queue,
  workspaceId: string,
  contactIds: readonly string[],
): Promise<void> {
  const uniqueIds = [...new Set(contactIds)].filter(Boolean);
  for (let index = 0; index < uniqueIds.length; index += 100) {
    await queue.sendBatch(
      uniqueIds.slice(index, index + 100).map((contactId) => ({
        body: { kind: "segment_contact_reconcile" as const, workspaceId, contactId },
      })),
    );
  }
}
