import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Saved scanner research scripts (CommonJS, not app code).
    "scripts/outline-eval/**",
    // The iPhone app (docs/APP-PLAN.md) has its own package, config and lint.
    "mobile/**",
  ]),
]);

export default eslintConfig;
