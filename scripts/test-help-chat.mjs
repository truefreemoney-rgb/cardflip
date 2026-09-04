/**
 * The help robot's chat brain (lib/server/helpChat.ts). Run: npm run test:helpchat
 *
 * Pins: splitReply keeps known guide/link tags as actions and drops unknown
 * ones; askHelp refuses without an API key, sends the articles + account
 * facts as system blocks and the rolling history as messages, stores both
 * turns, parses the reply's tags, enforces the 40/day cap, and clear wipes
 * the thread. The model is a local HTTP stand-in for api.anthropic.com
 * (the SDK honours ANTHROPIC_BASE_URL), so no real call and no key needed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-helpchat-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

// The fake model: answers with whatever `nextReply` holds, records requests.
let nextReply = "Hello.";
const requests = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requests.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-4-5",
      content: [{ type: "text", text: nextReply }],
      stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
delete process.env.ANTHROPIC_API_KEY;

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { createUser } = await import(at("lib/server/users.ts"));
const { HELP_DAILY_CAP, HelpCapError, HelpNotConfiguredError, askHelp, clearHelpHistory, helpHistory, splitReply } = await import(at("lib/server/helpChat.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}
async function throwsWith(fn, cls) {
  try { await fn(); return false; } catch (e) { return e instanceof cls; }
}

// --- splitReply ---------------------------------------------------------------
check("guide tag becomes an action", splitReply("Tap Connect. {{guide:connect-ebay}}"),
  { content: "Tap Connect.", actions: [{ type: "guide", value: "connect-ebay" }] });
check("unknown guide id is dropped silently", splitReply("Nope {{guide:made-up}}"), { content: "Nope", actions: [] });
check("known link becomes an action", splitReply("Go there. {{link:/app/account}}").actions, [{ type: "link", value: "/app/account" }]);
check("unknown link is dropped", splitReply("Go {{link:/evil}}").actions, []);
check("guide + link both kept, blank lines collapsed", splitReply("A\n\n\n\n{{guide:publish}}\n{{link:/app/account}}"),
  { content: "A", actions: [{ type: "guide", value: "publish" }, { type: "link", value: "/app/account" }] });

// --- askHelp ------------------------------------------------------------------
const seller = await createUser("S", "seller@example.com", "hunter22");
check("no API key → HelpNotConfiguredError", await throwsWith(() => askHelp(seller, "hi"), HelpNotConfiguredError));
check("nothing stored when not configured", (await helpHistory(seller.id)).length, 0);

process.env.ANTHROPIC_API_KEY = "test-key";
check("empty message throws", await throwsWith(() => askHelp(seller, "   "), Error));

nextReply = "Account page, eBay card, Connect. {{guide:connect-ebay}}";
const reply = await askHelp(seller, "how do I connect ebay");
check("reply text has the tag stripped", reply.content, "Account page, eBay card, Connect.");
check("reply carries the guide action", reply.actions, [{ type: "guide", value: "connect-ebay" }]);
check("reply role", reply.role, "assistant");

const req1 = requests[0];
check("model is Haiku 4.5", req1.model, "claude-haiku-4-5");
check("three system blocks: voice, articles, account", req1.system.length, 3);
check("articles block is cached", req1.system[1].cache_control, { type: "ephemeral" });
check("articles block carries the help articles", req1.system[1].text.startsWith("# Help articles"));
check("account facts name the seller and tier", req1.system[2].text.includes("Name: S") && req1.system[2].text.includes("Access tier:"));
check("first ask sends just the new message", req1.messages, [{ role: "user", content: "how do I connect ebay" }]);

const history = await helpHistory(seller.id);
check("both turns stored in order", history.map((m) => m.role), ["user", "assistant"]);
check("stored assistant turn is split too", history[1].actions, [{ type: "guide", value: "connect-ebay" }]);

nextReply = "Already answered.";
await askHelp(seller, "and then?");
check("second ask replays the raw history (tags intact) before the new message",
  requests[1].messages.map((m) => m.content),
  ["how do I connect ebay", "Account page, eBay card, Connect. {{guide:connect-ebay}}", "and then?"]);

nextReply = "   ";
const blank = await askHelp(seller, "say nothing");
check("blank model reply gets the fallback line", blank.content.includes("support@cardflip.io"));

nextReply = "Long one.";
await askHelp(seller, "x".repeat(900));
check("message is capped at 600 chars", requests[3].messages.at(-1).content.length, 600);

// --- daily cap ----------------------------------------------------------------
const other = await createUser("O", "other@example.com", "hunter22");
const now = Date.now();
for (let i = 0; i < HELP_DAILY_CAP; i++) {
  await db.prepare("INSERT INTO help_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)").run(`u${i}`, other.id, "user", "q", now - i);
}
check("40 user turns in 24h → HelpCapError", await throwsWith(() => askHelp(other, "one more"), HelpCapError));
await db.prepare("UPDATE help_messages SET created_at = ? WHERE user_id = ?").run(now - 25 * 60 * 60 * 1000, other.id);
nextReply = "Fresh day.";
check("old turns don't count", (await askHelp(other, "one more")).content, "Fresh day.");
check("cap doesn't leak across users", (await helpHistory(seller.id)).length, 8);

// --- clear --------------------------------------------------------------------
await clearHelpHistory(seller.id);
check("clear wipes the thread", (await helpHistory(seller.id)).length, 0);
check("clear leaves other users alone", (await helpHistory(other.id)).length > 0);

server.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
