import { normalizeGatewaySearchResponse } from "./company-enrichment-normalization";
import type { SearchDigest } from "./company-enrichment-types";

const SEARCH_MODEL = "anthropic/claude-haiku-4.5";

export async function runGatewaySearch(
  ai: Ai,
  objective: string,
  signal?: AbortSignal,
): Promise<SearchDigest> {
  signal?.throwIfAborted();
  const response = await ai.run(
    SEARCH_MODEL,
    {
      max_tokens: 2_500,
      messages: [{ role: "user", content: objective }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
    },
    {
      gateway: {
        id: "default",
        skipCache: true,
        collectLog: true,
        requestTimeoutMs: 30_000,
        retries: { maxAttempts: 2, backoff: "exponential" },
      },
      ...(signal ? { signal } : {}),
    },
  );
  signal?.throwIfAborted();
  return normalizeGatewaySearchResponse(response);
}
