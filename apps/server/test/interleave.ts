/**
 * Wraps D1 so `before` runs once, immediately ahead of the next batch. It
 * stands in for a concurrent request that commits between a repository's
 * precondition read and its write.
 */
export function interleaveBeforeBatch(
  source: D1Database,
  before: () => Promise<unknown>,
): D1Database {
  let pending: (() => Promise<unknown>) | null = before;
  return new Proxy(source, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const run = pending;
          pending = null;
          if (run) await run();
          return target.batch(statements);
        };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
