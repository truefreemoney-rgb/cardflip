/**
 * Site switches, the tour stamp, and the admin plan override column — the
 * three small persisted flags added 09-04. Run: npm run test:settings
 *
 * Pins: settings get/set round-trip and upsert; magic_public defaults OFF
 * and admins always see Magic; markTourSeen stamps once and reads back on
 * the user; setAccessOverride persists every valid value, clears with null,
 * and a garbage value in the column reads as null (never as a tier).
 *
 * Same throwaway-db trick as test-auth.mjs: chdir to a temp dir before any
 * import so `data/cardflip.db` lands there.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-settings-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { ACCESS_OVERRIDES, createUser, findUserById, markTourSeen, setAccessOverride, setUserRole, toPublicUser } = await import(at("lib/server/users.ts"));
const { getSetting, setSetting, magicPublic, magicVisibleFor, MAGIC_PUBLIC_KEY } = await import(at("lib/server/settings.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

// --- settings ----------------------------------------------------------------
check("unset key reads null", await getSetting("nope"), null);
await setSetting("k", "1");
check("set then get", await getSetting("k"), "1");
await setSetting("k", "2");
check("upsert replaces", await getSetting("k"), "2");
check("magic_public defaults off", await magicPublic(), false);

const seller = await createUser("S", "seller@example.com", "hunter22");
const admin = await createUser("A", "admin@example.com", "hunter22", "admin");
check("magic off: seller no, admin yes, signed-out no",
  [await magicVisibleFor(seller), await magicVisibleFor(admin), await magicVisibleFor(null)],
  [false, true, false]);
await setSetting(MAGIC_PUBLIC_KEY, "1");
check("magic on: everyone", [await magicVisibleFor(seller), await magicVisibleFor(null)], [true, true]);
await setSetting(MAGIC_PUBLIC_KEY, "0");
check("magic back off", await magicPublic(), false);

// --- tour stamp --------------------------------------------------------------
check("fresh account owes the tour", toPublicUser(seller).tourSeenAt, null);
await markTourSeen(seller.id);
const stamped = await findUserById(seller.id);
check("markTourSeen stamps a time", typeof stamped.tourSeenAt === "number" && stamped.tourSeenAt > 0);
check("public user carries the stamp", toPublicUser(stamped).tourSeenAt, stamped.tourSeenAt);

// --- access override ---------------------------------------------------------
check("fresh account has no override", stamped.accessOverride, null);
for (const v of ACCESS_OVERRIDES) {
  await setAccessOverride(seller.id, v);
  check(`override persists: ${v}`, (await findUserById(seller.id)).accessOverride, v);
}
await setAccessOverride(seller.id, null);
check("override clears with null", (await findUserById(seller.id)).accessOverride, null);
await db.prepare("UPDATE users SET access_override = ? WHERE id = ?").run("bogus", seller.id);
check("garbage column value reads as null", (await findUserById(seller.id)).accessOverride, null);
check("garbage value does not change the tier", toPublicUser(await findUserById(seller.id)).tier, "trial");
await setAccessOverride(seller.id, "comp_pro");
const comped = toPublicUser(await findUserById(seller.id));
check("comped Pro shows as subscribed Pro with 2,000 scans and app access",
  [comped.tier, comped.plan, comped.monthlyScans, comped.appAccess], ["subscribed", "pro", 2000, true]);
await setUserRole(seller.id, "admin");
await setAccessOverride(seller.id, null);
check("admin with no override is owner", toPublicUser(await findUserById(seller.id)).tier, "owner");

console.log(failures === 0 ? "\nAll settings checks passed" : `\n${failures} settings check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
