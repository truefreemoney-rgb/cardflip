import "server-only";
import { randomUUID } from "node:crypto";
import { db, type DbTx } from "@/lib/db";
import { PRICING, ROLLOVER } from "@/lib/pricing";
import { seedKey } from "@/lib/planSeed";
import { fromRow, planOf, planSeedFor, type Plan, type User, type UserRow } from "@/lib/server/users";

/**
 * The scan-credit ledger and every write to users.plan_scans that is not a
 * spend (Chris, 09-30: scans arrive when a payment clears and stack). Money
 * safety rules, all enforced here so no caller can get them wrong:
 *  - the ledger row and the balance change are ONE transaction, so a failure
 *    leaves neither (no half credit, and a retry can never see a row without
 *    its scans);
 *  - the ledger key is the idempotency key: a replayed credit changes nothing;
 *  - a NULL balance (not migrated yet) is seeded first, in the same
 *    transaction, so a credit can never hide the seed or overwrite it: every
 *    write ADDS to the balance, nothing assigns it.
 */

export type CreditKind = "payment" | "proration" | "migration" | "admin" | "reversal";

export interface LedgerRow {
  credit_key: string;
  user_id: string;
  kind: CreditKind;
  plan: string | null;
  scans: number;
  applied: number;
  balance_before: number | null;
  price_id: string | null;
  ref_key: string | null;
  charge_id: string | null;
  payment_intent: string | null;
  note: string | null;
  created_at: number;
}

export interface CreditOutcome {
  /** True when this call changed the ledger (false = the key was already used, nothing happened). */
  recorded: boolean;
  /** Scans that actually moved the balance (a cap trims a credit, a reversal floors at zero). */
  applied: number;
  /** The one-time seed written first, when this was the account's first touch of a NULL balance. */
  seeded: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
  /** Why nothing (or less) was credited when it was not the plain case. */
  note?: string;
}

const NOTHING: CreditOutcome = { recorded: false, applied: 0, seeded: 0, balanceBefore: null, balanceAfter: null };

const INSERT_ROW = `INSERT OR IGNORE INTO scan_credits
  (credit_key, user_id, kind, plan, scans, applied, balance_before, price_id, ref_key, charge_id, payment_intent, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function readUser(tx: DbTx, userId: string): Promise<User | null> {
  const row = (await tx.prepare("SELECT * FROM users WHERE id = ?").get(userId)) as UserRow | undefined;
  return row ? fromRow(row) : null;
}

/**
 * Seed a NULL balance from the old counter when it is owed (planSeedFor).
 * Runs inside the caller's transaction; the ledger key migration:<userId>
 * makes it happen once whichever of the app, a payment or the migration script
 * gets there first. Returns the scans seeded (0 = nothing owed / already done).
 */
async function seedInTx(tx: DbTx, user: User, now: number): Promise<number> {
  const seed = planSeedFor(user, now);
  if (seed === null) return 0;
  const ins = await tx
    .prepare(INSERT_ROW)
    .run(seedKey(user.id), user.id, "migration", planOf(user), seed, seed, 0, null, null, null, null, "seeded from the old monthly counter on first use", now);
  if (!ins.changes) return 0;
  await tx.prepare("UPDATE users SET plan_scans = COALESCE(plan_scans, 0) + ? WHERE id = ?").run(seed, user.id);
  return seed;
}

/**
 * A brand-new subscription (checkout, subscription.created): this account owes
 * nothing from the old counter, so mark the balance 0 instead of NULL. Without
 * it, the seed rule ("a live subscriber whose balance is still NULL") would
 * hand a new subscriber the old allowance on top of their first payment
 * whenever the subscription event beat the invoice. Only touches a NULL balance.
 */
export async function markNoSeedOwed(userId: string): Promise<void> {
  await db.prepare("UPDATE users SET plan_scans = 0 WHERE id = ? AND plan_scans IS NULL").run(userId);
}

/**
 * First touch of an unmigrated subscriber's balance (a scan being reserved,
 * a payment, an adjustment): write the seed. A no-op for everyone else.
 */
export async function ensurePlanSeed(userId: string, now = Date.now()): Promise<number> {
  return db.transaction(async (tx) => {
    const user = await readUser(tx, userId);
    return user ? seedInTx(tx, user, now) : 0;
  });
}

export interface CreditInput {
  userId: string;
  /** The Stripe invoice id (the idempotency key). */
  key: string;
  kind: "payment" | "proration";
  plan: Plan;
  scans: number;
  priceId?: string | null;
  chargeId?: string | null;
  paymentIntent?: string | null;
  note?: string | null;
  now?: number;
  /**
   * false = never seed from the old counter first. Set for a subscription's
   * FIRST payment (billing_reason subscription_create, checkout): a brand-new
   * subscriber has no old-rules allowance, and whichever of `.created` /
   * `.updated` / invoice.paid arrives first must not hand them one.
   */
  seed?: boolean;
}

/**
 * Add scans for a paid invoice. Once per key; the optional ROLLOVER.maxMonths
 * cap trims (never removes) what a NEW credit adds; a payment that was already
 * fully refunded before its credit arrived is recorded with 0 scans.
 */
export async function creditPlanScans(o: CreditInput): Promise<CreditOutcome> {
  const now = o.now ?? Date.now();
  return db.transaction(async (tx) => {
    const user = await readUser(tx, o.userId);
    if (!user) return { ...NOTHING, note: "no such user" };
    const dup = await tx.prepare("SELECT 1 AS x FROM scan_credits WHERE credit_key = ?").get(o.key);
    if (dup) return { ...NOTHING, note: "already credited" };

    const seeded = o.seed === false ? 0 : await seedInTx(tx, user, now);
    const before = (user.planScans ?? 0) + seeded;

    let grant = Math.max(0, Math.round(o.scans));
    let note: string | undefined;
    const refunded = await tx.prepare("SELECT 1 AS x FROM scan_credits WHERE ref_key = ? AND kind = 'reversal'").get(o.key);
    if (refunded) {
      grant = 0;
      note = "refunded before it was credited";
    } else if (ROLLOVER.maxMonths != null) {
      const room = Math.max(0, Math.round(ROLLOVER.maxMonths * PRICING[o.plan].scans) - before);
      if (grant > room) {
        grant = room;
        note = `trimmed to the cap (${ROLLOVER.maxMonths} months)`;
      }
    }

    const ins = await tx
      .prepare(INSERT_ROW)
      .run(o.key, o.userId, o.kind, o.plan, o.scans, grant, before, o.priceId ?? null, o.key, o.chargeId ?? null, o.paymentIntent ?? null, note ?? o.note ?? null, now);
    if (!ins.changes) return { ...NOTHING, note: "already credited" };
    if (grant > 0) {
      if (o.kind === "payment") {
        await tx
          .prepare("UPDATE users SET plan_scans = COALESCE(plan_scans, 0) + ?, plan_credit_scans = ?, plan_credit_at = ? WHERE id = ?")
          .run(grant, grant, now, o.userId);
      } else {
        await tx.prepare("UPDATE users SET plan_scans = COALESCE(plan_scans, 0) + ? WHERE id = ?").run(grant, o.userId);
      }
    }
    return { recorded: true, applied: grant, seeded, balanceBefore: before, balanceAfter: before + grant, ...(note ? { note } : {}) };
  });
}

export interface ReversalInput {
  userId: string;
  /** refund:<chargeId>:<amountRefunded> or dispute:<id>. */
  key: string;
  /** The invoice whose credit this undoes. */
  refKey: string;
  /** Scans to take back (positive); the balance floors at zero. */
  scans: number;
  chargeId?: string | null;
  note?: string | null;
  now?: number;
}

/** Take back scans for a refund or dispute: never below zero, once per key. */
export async function reversePlanScans(o: ReversalInput): Promise<CreditOutcome> {
  const now = o.now ?? Date.now();
  return db.transaction(async (tx) => {
    const dup = await tx.prepare("SELECT 1 AS x FROM scan_credits WHERE credit_key = ?").get(o.key);
    if (dup) return { ...NOTHING, note: "already reversed" };
    const row = (await tx.prepare("SELECT plan_scans FROM users WHERE id = ?").get(o.userId)) as { plan_scans: number | null } | undefined;
    if (!row) return { ...NOTHING, note: "no such user" };
    const before = row.plan_scans ?? 0;
    const want = Math.max(0, Math.round(o.scans));
    const debit = Math.min(want, Math.max(0, before));
    const ins = await tx
      .prepare(INSERT_ROW)
      .run(o.key, o.userId, "reversal", null, -want, -debit, before, null, o.refKey, o.chargeId ?? null, null, o.note ?? null, now);
    if (!ins.changes) return { ...NOTHING, note: "already reversed" };
    if (debit > 0) await tx.prepare("UPDATE users SET plan_scans = plan_scans - ? WHERE id = ?").run(debit, o.userId);
    return { recorded: true, applied: -debit, seeded: 0, balanceBefore: before, balanceAfter: before - debit };
  });
}

/**
 * A payment fully refunded before its credit was ever written: leave a marker
 * (0 scans) so the credit, when it arrives late (the daily reconcile, a
 * delayed event), lands as 0 instead of handing out scans for money returned.
 */
export async function recordRefundBeforeCredit(userId: string, key: string, invoiceId: string, chargeId: string | null, now = Date.now()): Promise<boolean> {
  const ins = await db
    .prepare(INSERT_ROW)
    .run(key, userId, "reversal", null, 0, 0, null, null, invoiceId, chargeId, null, "refunded before it was credited", now);
  return ins.changes > 0;
}

/**
 * Owner-only hand adjustment ("Chris refunds a payment", a goodwill grant, a
 * fix): a ledger row of kind admin. A negative delta floors at zero.
 */
export async function adjustPlanScans(userId: string, delta: number, note: string, now = Date.now()): Promise<CreditOutcome> {
  return db.transaction(async (tx) => {
    const user = await readUser(tx, userId);
    if (!user) return { ...NOTHING, note: "no such user" };
    const seeded = await seedInTx(tx, user, now);
    const before = (user.planScans ?? 0) + seeded;
    const want = Math.round(delta);
    const applied = want >= 0 ? want : -Math.min(-want, before);
    await tx.prepare(INSERT_ROW).run(`admin:${randomUUID()}`, userId, "admin", null, want, applied, before, null, null, null, null, note.slice(0, 300), now);
    if (applied !== 0) await tx.prepare("UPDATE users SET plan_scans = COALESCE(plan_scans, 0) + ? WHERE id = ?").run(applied, userId);
    return { recorded: true, applied, seeded, balanceBefore: before, balanceAfter: before + applied };
  });
}

// --- ledger reads -------------------------------------------------------------

/** The payment or proration credit for an invoice id, if it was ever written. */
export async function creditForInvoice(invoiceId: string): Promise<LedgerRow | null> {
  const row = await db.prepare("SELECT * FROM scan_credits WHERE credit_key = ? AND kind IN ('payment', 'proration')").get<LedgerRow>(invoiceId);
  return row ?? null;
}

/** A payment credit found by the charge or payment intent Stripe names on a refund or dispute. */
export async function creditForCharge(chargeId: string | null, paymentIntent: string | null): Promise<LedgerRow | null> {
  if (chargeId) {
    const row = await db.prepare("SELECT * FROM scan_credits WHERE charge_id = ? AND kind IN ('payment', 'proration')").get<LedgerRow>(chargeId);
    if (row) return row;
  }
  if (paymentIntent) {
    const row = await db.prepare("SELECT * FROM scan_credits WHERE payment_intent = ? AND kind IN ('payment', 'proration')").get<LedgerRow>(paymentIntent);
    if (row) return row;
  }
  return null;
}

/** Remember which charge paid an invoice's credit, so the next refund lookup is local. */
export async function rememberCharge(invoiceId: string, chargeId: string | null, paymentIntent: string | null): Promise<void> {
  if (!chargeId && !paymentIntent) return;
  await db
    .prepare("UPDATE scan_credits SET charge_id = COALESCE(charge_id, ?), payment_intent = COALESCE(payment_intent, ?) WHERE credit_key = ?")
    .run(chargeId, paymentIntent, invoiceId);
}

/** Scans already taken back for an invoice by earlier (partial) refunds, as asked (positive). */
export async function reversedScansFor(invoiceId: string): Promise<number> {
  const row = (await db.prepare("SELECT COALESCE(SUM(-scans), 0) AS n FROM scan_credits WHERE ref_key = ? AND kind = 'reversal'").get(invoiceId)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Which of these invoice ids already have a ledger row (any kind). */
export async function ledgerKeysPresent(keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const rows = (await db
      .prepare(`SELECT credit_key FROM scan_credits WHERE credit_key IN (${chunk.map(() => "?").join(", ")})`)
      .all(...chunk)) as { credit_key: string }[];
    for (const r of rows) found.add(r.credit_key);
  }
  return found;
}

/** The newest ledger rows for one account (the admin's "why is this balance what it is"). */
export async function ledgerForUser(userId: string, limit = 50): Promise<LedgerRow[]> {
  return (await db.prepare("SELECT * FROM scan_credits WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit)) as unknown as LedgerRow[];
}
