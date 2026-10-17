/**
 * Unsubscribe link (A-H #24, 10-17): opening it (a mail scanner, a preview) must not unsubscribe;
 * the page's button and the mail app's one-tap POST (RFC 8058) do. Run: npm run test:unsubscribe
 *
 * Throwaway db as in test-auth-routes: chdir to a temp dir before any import.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-unsub-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const route = await import(at("app/api/digest/unsubscribe/route.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { digestTokenFor } = await import(at("lib/server/digest.ts"));
const { db } = await import(at("lib/db.ts"));
const { NextRequest } = await import("next/server");

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const off = async (id) => (await db.prepare("SELECT digest_off AS o FROM users WHERE id = ?").get(id)).o;
const url = (u, t, k) => `https://cardflip.io/api/digest/unsubscribe?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}${k ? `&k=${k}` : ""}`;
const get = (u, t, k) => route.GET(new NextRequest(url(u, t, k)));
const post = (target, fields) => route.POST(new NextRequest(target, { method: "POST", body: new URLSearchParams(fields), headers: { "content-type": "application/x-www-form-urlencoded" } }));

const a = await createUser("Ann", "ann@example.com", "hunter22");
const ta = await digestTokenFor(a.id);

console.log("opening the link");
const g = await get(a.id, ta, "updates");
const gBody = await g.text();
check("GET: 200 page with an Unsubscribe button", [g.status, gBody.includes("<form method=\"post\""), gBody.includes(">Unsubscribe</button>")], [200, true, true]);
check("GET: does NOT unsubscribe (mail scanners open every link)", await off(a.id), 0);
await get(a.id, ta, "updates");
check("GET twice: still subscribed", await off(a.id), 0);
check("GET: wording for update mails", gBody.includes("update emails or Sunday digests"), true);
check("GET: noindex", gBody.includes('name="robots" content="noindex"'), true);
check("GET: bad token = 400, nothing changes", [(await get(a.id, "nope")).status, await off(a.id)], [400, 0]);
check("GET: missing params = 400", (await get("", "")).status, 400);

console.log("the button");
const p = await post("https://cardflip.io/api/digest/unsubscribe", { u: a.id, t: ta, k: "updates" });
check("POST form: done page, now unsubscribed", [p.status, (await p.text()).includes("You're Unsubscribed"), await off(a.id)], [200, true, 1]);
const again = await (await get(a.id, ta)).text();
check("GET after: says already unsubscribed, no button", [again.includes("You're Unsubscribed"), again.includes("<form")], [true, false]);
check("POST form with a bad token: 400", (await post("https://cardflip.io/api/digest/unsubscribe", { u: a.id, t: "nope" })).status, 400);

console.log("one-tap from the mail app (RFC 8058)");
const b = await createUser("Bo", "bo@example.com", "hunter22");
const tb = await digestTokenFor(b.id);
const oc = await post(url(b.id, tb), { "List-Unsubscribe": "One-Click" });
check("one-click POST to the link: 200 plain, unsubscribed", [oc.status, (oc.headers.get("content-type") ?? "").includes("text/html"), await off(b.id)], [200, false, 1]);
check("one-click with a bad token: 400", (await post(url(b.id, "nope"), { "List-Unsubscribe": "One-Click" })).status, 400);

console.log("mail headers ask for one-click");
const { readFileSync } = await import("node:fs");
const mail = readFileSync(new URL("../src/lib/server/mail.ts", import.meta.url), "utf8");
check("every List-Unsubscribe header has List-Unsubscribe-Post", (mail.match(/"List-Unsubscribe":/g) ?? []).length === (mail.match(/"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/g) ?? []).length, true);

console.log(failures ? `\n${failures} failure(s)` : "\nall unsubscribe checks passed");
process.exit(failures ? 1 : 0);
