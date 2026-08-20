// Repository tests deliberately need a broad setup surface (tables, client,
// repositories, and deterministic helpers). Production imports are kept on
// owner-specific entrypoints and enforced by scripts/check-architecture.mjs.
export * from "./index";
