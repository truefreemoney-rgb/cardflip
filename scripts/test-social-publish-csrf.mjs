/**
 * /api/social/publish takes the owner cookie on a same-origin POST only
 * (10-01 security sweep): the admin cookie is SameSite=Lax, so a cross-site
 * top-level GET carried it and any page Chris opened could fire ?force=1 at
 * every social site. Run: npm run test:publishcsrf
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-publish-csrf-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});
process.env.ADMIN_PANEL_USER = "ops";
process.env.ADMIN_PANEL_PASSWORD = "s3cret";
process.env.EBAY_TOKEN_KEY = "test-key";
delete process.env.CRON_SECRET;
process.env.SOCIAL_POST_KEY = "post-key";

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { NextRequest } = await import("next/server");
const { testCookies } = await import("next/headers");
const { ADMIN_COOKIE, signAdminToken } = await import(at("lib/adminAuth.ts"));
const route = await import(at("app/api/social/publish/route.ts"));

const ORIGIN = "https://cardflip.io";
const req = (method, { origin, key } = {}) =>
  new NextRequest(`${ORIGIN}/api/social/publish?dry=1&force=1&day=2026-10-01${key ? `&key=${key}` : ""}`, { method, headers: origin ? { origin } : {} });
const allowed = (r) => r.status !== 401 && r.status !== 403 && r.status !== 503;

testCookies.set(ADMIN_COOKIE, signAdminToken().token);
check("owner cookie on a GET (a cross-site link or <img>) is refused", allowed(await route.GET(req("GET"))), false);
check("owner cookie on a cross-site POST is refused", allowed(await route.POST(req("POST", { origin: "https://evil.example" }))), false);
check("owner cookie on a same-origin POST (the console's Post Now) still works", allowed(await route.POST(req("POST", { origin: ORIGIN }))), true);
testCookies.delete(ADMIN_COOKIE);
check("the schedule's key still works on a GET with no cookie", allowed(await route.GET(req("GET", { key: "post-key" }))), true);
check("no cookie and no key is refused", allowed(await route.POST(req("POST", { origin: ORIGIN }))), false);

// The shared constant-time compare every machine-key route uses now (lib/server/secretEqual.ts): fails closed.
const { secretEqual } = await import(at("lib/server/secretEqual.ts"));
check("secretEqual: match, mismatch, prefix, and an unset or empty secret never matches", [
  secretEqual("k3y", "k3y"), secretEqual("k3y", "k3z"), secretEqual("k3", "k3y"), secretEqual(null, "k3y"), secretEqual("k3y", undefined), secretEqual("", ""),
], [true, false, false, false, false, false]);

// /api/ops/alert mails Chris a link: only a run on this repo's Actions (10-01 sweep: a leaked key could send a phishing
// link inside a trusted alert). Route files may only export handlers, so the pattern is read from the source.
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/app/api/ops/alert/route.ts", import.meta.url), "utf8");
  const m = /const RUN_URL = \/(.+)\/;/.exec(src);
  const re = m ? new RegExp(m[1]) : null;
  const t = (u) => Boolean(re && re.test(u));
  check("ops alert link: this repo's run pages only", [
    t("https://github.com/truefreemoney-rgb/cardflip/actions/runs/36807853573"),
    t("https://github.com/truefreemoney-rgb/cardflip/actions/runs/36807853573/job/110187134473"),
    t("https://github.com/attacker/cardflip/actions/runs/1"),
    t("https://github.com.evil.example/truefreemoney-rgb/cardflip/actions/runs/1"),
    t("https://evil.example/?https://github.com/truefreemoney-rgb/cardflip/actions/runs/1"),
    t("javascript:alert(1)"),
  ], [true, true, false, false, false, false]);
  check("…and the route uses it before mailing", /RUN_URL\.test\(rawUrl\) \? rawUrl : undefined/.test(src), true);
}

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);
