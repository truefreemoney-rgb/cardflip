/**
 * Support tickets (lib/server/supportTickets.ts). Run: npm run test:supporttickets
 *
 * Pins: numbering starts at 1000 and climbs, subject falls back to the first
 * line, the support mail goes to the inbox with Reply-To the seller and the
 * transcript, the seller gets a receipt, five open tickets is the cap,
 * closing mails the seller once and is idempotent, reopen clears closed_at,
 * a seller only lists their own, and deleteUser takes the rows with it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-tickets-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
delete process.env.SMTP_HOST;

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { createUser, deleteUser } = await import(at("lib/server/users.ts"));
const { OPEN_TICKETS_PER_USER, TicketInputError, TicketLimitError, addTicketNote, cleanImages, getTicket, getUserTicket, listAllTickets, listUserTickets, openTicket, openTicketCount, setTicketStatus, ticketTag } = await import(at("lib/server/supportTickets.ts"));
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

const sent = [];
const mail = {
  support: async (to, t, u, transcript) => { sent.push({ kind: "support", to, number: t.number, subject: t.subject, replyTo: u.email, turns: transcript.length }); },
  receipt: async (to, t) => { sent.push({ kind: "receipt", to, number: t.number }); },
};
const closedMail = async (to, t) => { sent.push({ kind: "closed", to, number: t.number }); };

const a = await createUser("Ash", "ash@x.io", "pw-long-enough");
const b = await createUser("Brock", "brock@x.io", "pw-long-enough");

console.log("open");
check("empty body refused", await throwsWith(() => openTicket(a, { subject: "", body: "   " }, [], { mail }), TicketInputError));
const t1 = await openTicket(a, { subject: "", body: "Scan keeps failing\nOn a Charizard." }, [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], { mail });
check("number 1000, subject from first line, open", [t1.number, t1.subject, t1.status, t1.closedAt], [1000, "Scan keeps failing", "open", null]);
check("tag", ticketTag(t1), "SUPPORT TICKET #1000");
check("support mail + receipt", sent, [
  { kind: "support", to: "support@cardflip.io", number: 1000, subject: "Scan keeps failing", replyTo: "ash@x.io", turns: 2 },
  { kind: "receipt", to: "ash@x.io", number: 1000 },
]);
sent.length = 0;
const t2 = await openTicket(b, { subject: "  Refund please ", body: "x".repeat(3000) }, [], { mail });
check("number climbs across users, subject trimmed, body capped", [t2.number, t2.subject, t2.body.length], [1001, "Refund please", 2000]);
check("mail failure keeps the row", (await openTicket(a, { subject: "q", body: "b" }, [], { mail: { support: async () => { throw new Error("smtp down"); }, receipt: mail.receipt } })).number, 1002);
sent.length = 0;

console.log("lists");
check("ash sees only hers, newest first", (await listUserTickets(a.id)).map((t) => t.number), [1002, 1000]);
check("open count", await openTicketCount(a.id), 2);
check("admin list: all, with who", (await listAllTickets()).map((t) => [t.number, t.status, t.userEmail]), [[1002, "open", "ash@x.io"], [1001, "open", "brock@x.io"], [1000, "open", "ash@x.io"]]);

console.log("cap");
for (let i = 0; i < OPEN_TICKETS_PER_USER - 2; i++) await openTicket(a, { subject: "", body: `spam ${i}` }, [], { mail });
check("open tickets are capped at 3", OPEN_TICKETS_PER_USER, 3);
check("one past the cap is refused", await throwsWith(() => openTicket(a, { subject: "", body: "one more" }, [], { mail }), TicketLimitError));

console.log("photos + notes");
const GOOD = "https://abc123.public.blob.vercel-storage.com/tickets/photo-1.jpg";
const GOOD2 = "https://abc123.public.blob.vercel-storage.com/tickets/photo-2.jpg";
check("cleanImages keeps our tickets/ URLs, drops the rest, dedupes, caps at 4",
  cleanImages([GOOD, "https://evil.example/x.jpg", "https://abc123.public.blob.vercel-storage.com/board/x.jpg", GOOD, GOOD2, 5, GOOD2 + "3", GOOD2 + "4", GOOD2 + "5"]),
  [GOOD, GOOD2, GOOD2 + "3", GOOD2 + "4"]);
const noteSent = [];
const noteMail = async (to, t, u, n) => { noteSent.push({ to, number: t.number, replyTo: u.email, body: n.body, images: n.images }); };
const n1 = await addTicketNote(a, t1.id, { body: "  Also the back photo is blurry.  ", images: [GOOD, "https://evil.example/x.jpg"] }, { noteMail });
check("note: trimmed body, cleaned images", [n1.body, n1.images], ["Also the back photo is blurry.", [GOOD]]);
check("note mails support@ as a reply, reply-to the seller", noteSent, [{ to: "support@cardflip.io", number: 1000, replyTo: "ash@x.io", body: "Also the back photo is blurry.", images: [GOOD] }]);
const n2 = await addTicketNote(a, t1.id, { body: "", images: [GOOD2] }, { noteMail });
check("photos-only note is fine", [n2.body, n2.images], ["", [GOOD2]]);
check("empty note refused", await throwsWith(() => addTicketNote(a, t1.id, { body: "  ", images: [] }, { noteMail }), TicketInputError));
check("brock can't add to ash's ticket", await throwsWith(() => addTicketNote(b, t1.id, { body: "hi" }, { noteMail }), TicketInputError));
check("seller detail carries notes in order", (await getUserTicket(a.id, t1.id)).notes.map((n) => n.body), ["Also the back photo is blurry.", ""]);
check("someone else's detail is null", await getUserTicket(b.id, t1.id), null);
check("admin list carries notes + images", (await listAllTickets()).find((t) => t.id === t1.id).notes.length, 2);
const withPhotos = await openTicket(b, { subject: "", body: "", images: [GOOD] }, [], { mail });
check("photos-only ticket: subject falls back, images kept", [withPhotos.subject, withPhotos.images], ["Photos", [GOOD]]);
check("ticket with neither text nor photos refused", await throwsWith(() => openTicket(b, { subject: "x", body: "", images: [] }, [], { mail }), TicketInputError));

console.log("status");
sent.length = 0;
const closed = await setTicketStatus(t1.id, "closed", { closedMail });
check("closed: status + closed_at + one mail", [closed.status, typeof closed.closedAt, sent], ["closed", "number", [{ kind: "closed", to: "ash@x.io", number: 1000 }]]);
await setTicketStatus(t1.id, "closed", { closedMail });
check("closing again mails nothing", sent.length, 1);
check("closed tickets refuse notes", await throwsWith(() => addTicketNote(a, t1.id, { body: "still broken" }, { noteMail }), TicketInputError));
const reopened = await setTicketStatus(t1.id, "open", { closedMail });
check("reopen clears closed_at", [reopened.status, reopened.closedAt], ["open", null]);
check("open first in the admin list", (await listAllTickets())[0].status, "open");
check("unknown id", await setTicketStatus("nope", "closed", { closedMail }), null);
check("closing frees a slot", (await setTicketStatus(t1.id, "closed", { closedMail })).status, "closed");
check("then a new one opens", (await openTicket(a, { subject: "", body: "after close" }, [], { mail })).status, "open");

console.log("delete");
await deleteUser(a.id);
check("deleteUser takes tickets", (await db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ?").get(a.id)).n, 0);
check("brock's stays", (await getTicket(t2.id))?.number, 1001);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall support ticket checks passed");
