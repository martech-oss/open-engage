export const createIsomorphicFn = () => ({ client: (fn: () => unknown) => ({ server: () => fn }) });
export const getRequestUrl = () => new URL(window.location.href);
