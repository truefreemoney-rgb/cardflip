import fs from "node:fs";
import path from "node:path";

/**
 * The ONLY way a script gets an Anthropic key. Replay/panel/A-B scripts used
 * to read ANTHROPIC_API_KEY from .env.vercel.local — the production key —
 * and September 2026's accuracy testing put ~$38 on the prod bill without
 * Chris seeing it coming (memory: cardflip-vision-token-budget; Chris 09-27:
 * "we cant have money leaks like that again").
 *
 * Now: a separate key from a "Testing" workspace on the Anthropic console
 * with its own hard monthly spend limit, kept in .env.testing.local as
 * ANTHROPIC_DEV_API_KEY. No key = the script stops before any call. The
 * production key is never read here, and this helper refuses a key that
 * matches it.
 */
export const TESTING_ENV_FILE = ".env.testing.local";

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

export function devAnthropicKey(root = process.cwd()) {
  const dev = readEnv(path.join(root, TESTING_ENV_FILE)).ANTHROPIC_DEV_API_KEY?.trim();
  if (!dev) {
    console.error(
      [
        `No ANTHROPIC_DEV_API_KEY in ${TESTING_ENV_FILE}. Scripts never use the production key.`,
        "Make one on console.anthropic.com: Settings → Workspaces → the Testing workspace (monthly spend limit set)",
        "→ API keys → Create key → paste it as ANTHROPIC_DEV_API_KEY=... in " + TESTING_ENV_FILE,
      ].join("\n"),
    );
    process.exit(1);
  }
  const prod = readEnv(path.join(root, ".env.vercel.local")).ANTHROPIC_API_KEY?.trim();
  if (prod && dev === prod) {
    console.error(`ANTHROPIC_DEV_API_KEY in ${TESTING_ENV_FILE} is the production key. Use a Testing-workspace key.`);
    process.exit(1);
  }
  return dev;
}
