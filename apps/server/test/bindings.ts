import { env } from "cloudflare:workers";

import type { RuntimeEnv } from "../src/env";

/** The test Worker env with the given bindings replaced; an explicit undefined unsets one. */
export function withBindings(overrides: {
  [Key in keyof RuntimeEnv]?: RuntimeEnv[Key] | undefined;
}): RuntimeEnv {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return Reflect.get(overrides, property);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as RuntimeEnv;
}
