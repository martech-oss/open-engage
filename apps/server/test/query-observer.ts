/** Measure real D1 query results without replacing query execution. */
export function observeQueries(source: D1Database) {
  const metrics = { calls: 0, roundTrips: 0, rowsRead: 0, resultBytes: 0, sql: [] as string[] };
  const statements = new WeakMap<
    D1PreparedStatement,
    { statement: D1PreparedStatement; query: string }
  >();
  const record = (result: unknown) => {
    if (result && typeof result === "object" && "meta" in result) {
      const meta = result.meta as { rows_read?: number };
      metrics.rowsRead += meta.rows_read ?? 0;
    }
    metrics.resultBytes += new TextEncoder().encode(JSON.stringify(result)).byteLength;
  };
  const wrap = (statement: D1PreparedStatement, query: string): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), query);
        if (key === "all" || key === "first" || key === "raw" || key === "run")
          return async (...args: unknown[]) => {
            metrics.calls++;
            metrics.roundTrips++;
            metrics.sql.push(query);
            const method = Reflect.get(target, key, target) as (
              ...args: unknown[]
            ) => Promise<unknown>;
            const result = await method.apply(target, args);
            record(result);
            return result;
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    statements.set(wrapped, { statement, query });
    return wrapped;
  };
  const database = new Proxy(source, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
      if (key === "batch")
        return async (batch: D1PreparedStatement[]) => {
          metrics.roundTrips++;
          metrics.calls += batch.length;
          const results = await target.batch(
            batch.map((item) => {
              const known = statements.get(item);
              metrics.sql.push(known?.query ?? "unknown batch statement");
              return known?.statement ?? item;
            }),
          );
          results.forEach(record);
          return results;
        };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database, metrics };
}
