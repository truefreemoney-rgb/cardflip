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
const { HELP_DAILY_CAP, HelpCapError, HelpNotConfiguredError, askHelp, clearHelpHistory, helpHistory, listRobotChats, rateHelpMessage, splitReply } = await import(at("lib/server/helpChat.ts"));
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
check("model is Sonnet 5.5 at low effort (10-14)", [req1.model, req1.output_config?.effort], ["claude-sonnet-5-5", "low"]);
check("four system blocks: voice, articles, objections, account", req1.system.length, 4);
check("the objections block closes the cached prefix", [req1.system[1].cache_control, req1.system[2].cache_control], [undefined, { type: "ephemeral" }]);
check("articles block carries the help articles", req1.system[1].text.startsWith("# Help articles"));
check("account facts name the seller and tier", req1.system[3].text.includes("Name: S") && req1.system[3].text.includes("Access tier:"));
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
check("blank model reply gets the fallback line + ticket offer", [blank.content.includes("A human might"), blank.actions], [true, [{ type: "ticket", value: "" }]]);
check("ticket tag becomes an action, once", splitReply("Not sure. {{ticket}} {{ticket}}"), { content: "Not sure.", actions: [{ type: "ticket", value: "" }] });

nextReply = "Long one.";
await askHelp(seller, "x".repeat(900));
check("message is capped at 600 chars", requests[3].messages.at(-1).content.length, 600);

// --- the robot opens a ticket -------------------------------------------------
const { listUserTickets } = await import(at("lib/server/supportTickets.ts"));
nextReply = "Done. {{open_ticket:Scan keeps failing|My scan of a Charizard keeps failing on the back photo.}}";
const opened = await askHelp(seller, "yes open it");
check("robot opens the ticket: number line + opened action",
  [opened.content.includes("Ticket #1000 is open"), opened.content.includes("open_ticket"), opened.actions],
  [true, false, [{ type: "opened", value: "1000" }]]);
const mine = await listUserTickets(seller.id);
check("ticket row: subject + first-person body", [mine.length, mine[0].subject, mine[0].body],
  [1, "Scan keeps failing", "My scan of a Charizard keeps failing on the back photo."]);
const storedTurn = await db.prepare("SELECT content FROM help_messages WHERE user_id = ? AND role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(seller.id);
check("stored turn carries opened, not open_ticket", [storedTurn.content.includes("{{opened:1000}}"), storedTurn.content.includes("open_ticket")], [true, false]);
nextReply = "Replay.";
await askHelp(seller, "thanks");
check("replay does not open a second ticket", (await listUserTickets(seller.id)).length, 1);
check("history shows the opened action", (await helpHistory(seller.id)).filter((m) => m.actions.some((a) => a.type === "opened")).length, 1);
check("splitReply: opened with a non-number is dropped", splitReply("x {{opened:abc}}").actions, []);
check("splitReply: a stray open_ticket is dropped, not acted on", splitReply("x {{open_ticket:a|b}}"), { content: "x", actions: [] });

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
check("cap doesn't leak across users", (await helpHistory(seller.id)).length, 12);

// --- clear --------------------------------------------------------------------
await clearHelpHistory(seller.id);
check("clear wipes the thread", (await helpHistory(seller.id)).length, 0);
check("clear leaves other users alone", (await helpHistory(other.id)).length > 0);

// --- clear does not reset the cap (10-01 sweep: 40 paid calls, Clear Chat, repeat) ---------------------------
const looper = await createUser("L", "looper@example.com", "hunter22");
nextReply = "ok";
for (let i = 0; i < HELP_DAILY_CAP; i++) {
  await askHelp(looper, `q${i}`);
  if (i % 10 === 9) await clearHelpHistory(looper.id);
}
await clearHelpHistory(looper.id);
check("40 asks with Clear Chat in between → the 41st is still capped", await throwsWith(() => askHelp(looper, "one more"), HelpCapError));

// --- small actions + thumbs + admin list (10-14) ---------------------------------------------------
const act = await createUser("A", "act@example.com", "hunter22");
check("splitReply: card tag becomes a card action", splitReply("Here. {{card:Charizard}}"), { content: "Here.", actions: [{ type: "card", value: "Charizard" }] });
check("splitReply: a stray giveback tag is dropped", splitReply("x {{giveback}}"), { content: "x", actions: [] });
nextReply = "Checking your last scans. {{giveback}}";
const gb = await askHelp(act, "my scan was wasted");
check("giveback runs and the tag becomes the result line", [gb.content.includes("{{"), /no scans in the last 15 minutes/.test(gb.content)], [false, true]);
nextReply = "Sending a code. {{resend_code}}";
const rc = await askHelp(act, "the code never came");
check("resend_code on a confirmed account says so, no tag left", [rc.content.includes("{{"), /already confirmed/.test(rc.content)], [false, true]);
check("rate: the seller's own robot turn takes a thumbs down", await rateHelpMessage(act.id, rc.id, -1), true);
check("rate: another user's turn is refused", await rateHelpMessage(seller.id, rc.id, -1), false);
check("rate: a user turn is refused", await rateHelpMessage(act.id, (await helpHistory(act.id)).find((m) => m.role === "user").id, 1), false);
check("history carries the rating", (await helpHistory(act.id)).find((m) => m.id === rc.id).rating, -1);
const chats = await listRobotChats(7);
check("admin list: the thumbs-down chat sorts first with its count", [chats[0].userId, chats[0].thumbsDown], [act.id, 1]);
check("admin list: every chat has the user's name and the turns in order", [chats[0].name, chats[0].messages[0].role, chats[0].messages.length], ["A", "user", 4]);
check("rate: 0 clears", [await rateHelpMessage(act.id, rc.id, 0), (await helpHistory(act.id)).find((m) => m.id === rc.id).rating], [true, null]);
check("askHelp sends the objections sheet as a system block", requests.at(-1).system.some((b) => b.text.startsWith("# Objections sheet")));
check("askHelp sends recent cards in the account facts", requests.at(-1).system.at(-1).text.includes("Recent cards in Inventory"));

server.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
