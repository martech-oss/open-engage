export async function archiveWebsiteResource({
  archive,
  onSuccess,
  onError,
}: {
  archive: () => Promise<unknown>;
  onSuccess: () => void;
  onError: (message: string) => void;
}): Promise<void> {
  try {
    await archive();
    onSuccess();
  } catch (error) {
    onError(error instanceof Error ? error.message : "操作に失敗しました");
  }
}
