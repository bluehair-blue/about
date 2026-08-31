import { AsyncLocalStorage } from "node:async_hooks";

import type { PhaseAEnv } from "../worker/phase-a-env";

const storageKey = Symbol.for("hanparan.runtime-env");
const shared = globalThis as typeof globalThis & {
  [storageKey]?: AsyncLocalStorage<PhaseAEnv>;
};
const storage = shared[storageKey] ??= new AsyncLocalStorage<PhaseAEnv>();

export function withRuntimeEnv<T>(env: PhaseAEnv, callback: () => T) {
  return storage.run(env, callback);
}

export async function getRuntimeEnv() {
  try {
    return (await import("cloudflare:workers")).env;
  } catch (error) {
    const fallback = storage.getStore();
    if (fallback) return fallback;
    throw error;
  }
}
