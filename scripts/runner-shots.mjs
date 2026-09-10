/**
 * Phone-size screenshots for the board runner (docs/RUNNER.md, "Prove it,
 * don't describe it"). Chris decides from pictures, so a visual task ships
 * with before/after images in the PR body, and the board shows them under
 * the task.
 *
 *   npm run runner:shots -- --issue 21 --label before / /pricing
 *   npm run runner:shots -- --issue 21 --label after --signup /app /app/collection
 *
 * Starts `next dev` itself if nothing answers on the port, renders each URL
 * at iPhone 13 size, writes docs/runs/<issue>/<label>-<slug>.jpg, and prints
 * the markdown to paste into the PR — linked by commit sha once committed
 * (the printed lines use the branch name; `--sha <sha>` rewrites them).
 * `--signup` makes a throwaway account first so /app pages render; `--full`
 * captures the whole page instead of the first screen.
 * Keep it to the screens the task touched: at most four URLs per label.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const issue = opt("issue");
const label = opt("label", "after");
const sha = opt("sha");
const base = opt("base", process.env.E2E_BASE_URL ?? "http://localhost:3000");
const urls = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--issue", "--label", "--sha", "--base"].includes(args[i - 1])));

if (!issue || !/^\d+$/.test(issue)) {
  console.error("usage: npm run runner:shots -- --issue <N> [--label before|after] [--signup] [--full] [--sha <commit>] <url> [<url> …]");
  process.exit(2);
}
if (urls.length === 0) urls.push("/");
if (urls.length > 4) {
  console.error("at most four URLs per label — pick the screens the task touched");
  process.exit(2);
}

const outDir = path.join("docs", "runs", issue);
mkdirSync(outDir, { recursive: true });

async function alive() {
  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(3_000) });
    return r.status < 500;
  } catch {
    return false;
  }
}

let server = null;
if (!(await alive())) {
  console.log(`starting next dev on ${base}…`);
  server = spawn("npm run dev", { shell: true, stdio: "ignore", env: { ...process.env, PORT: new URL(base).port || "3000" } });
  const started = Date.now();
  while (!(await alive())) {
    if (Date.now() - started > 120_000) {
      console.error("dev server did not answer within 2 minutes");
      server.kill();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
}

const slug = (u) => (u.replace(/^https?:\/\/[^/]+/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home").toLowerCase();
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: base, colorScheme: "dark" });
const page = await context.newPage();

if (flag("signup")) {
  const email = `runner-${Date.now().toString(36)}@example.com`;
  const res = await context.request.post(`${base}/api/auth/signup`, { data: { name: "Runner Shots", email, password: "hunter22hunter" } });
  if (res.status() !== 201) {
    console.error(`signup failed (${res.status()}) — is the dev DB reachable?`);
    await browser.close();
    server?.kill();
    process.exit(1);
  }
  await context.request.post(`${base}/api/account/tour`); // stamp the tour so it doesn't cover the page
}

const lines = [];
for (const u of urls) {
  const file = path.join(outDir, `${label}-${slug(u)}.jpg`);
  await page.goto(u, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => page.goto(u, { timeout: 90_000 }));
  await page.waitForTimeout(800); // fonts + first paint of client components
  await page.screenshot({ path: file, fullPage: flag("full"), scale: "css", type: "jpeg", quality: 80 }); // first screen by default (small changes stay visible); --full for the whole page
  const ref = sha ?? (await gitRef());
  const posix = file.split(path.sep).join("/");
  lines.push(`![${label} ${slug(u)}](https://raw.githubusercontent.com/truefreemoney-rgb/cardflip/${ref}/${posix})`);
  console.log(`wrote ${file}`);
}

await browser.close();
server?.kill();

console.log("\nPaste into the PR body (after you commit the PNGs; re-run with --sha <commit> for permanent links):\n");
console.log(lines.join("\n"));

async function gitRef() {
  return new Promise((resolve) => {
    const p = spawn("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(out.trim() || "main"));
  });
}
