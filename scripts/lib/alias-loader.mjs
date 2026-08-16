/**
 * Node resolve hook so plain-node scripts can import app modules that use the
 * `@/` path alias (tsconfig paths) and extensionless TypeScript imports.
 * Registered by scripts/lib/register-alias.mjs (`--import`).
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = new URL(specifier.slice(2), SRC);
    const path = fileURLToPath(base);
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      if (existsSync(path + ext) && !path.endsWith("/")) return next(base.href + ext, context);
    }
    return next(base.href, context);
  }
  return next(specifier, context);
}
