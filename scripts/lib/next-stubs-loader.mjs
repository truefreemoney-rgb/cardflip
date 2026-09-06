/**
 * Resolve hook that swaps Next's request-scoped modules for test stubs so
 * route handlers that call cookies() / revalidatePath() can run as plain
 * functions outside a Next request. Registered by register-next-stubs.mjs
 * (which also registers the @/ alias loader).
 */
const STUBS = {
  "next/headers": new URL("./stub-next-headers.mjs", import.meta.url).href,
  "next/cache": new URL("./stub-next-cache.mjs", import.meta.url).href,
};

export async function resolve(specifier, context, next) {
  const stub = STUBS[specifier];
  if (stub) return { url: stub, shortCircuit: true };
  return next(specifier, context);
}
