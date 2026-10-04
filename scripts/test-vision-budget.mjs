/**
 * The card read's time budget (lib/visionBudget.ts, Chris 10-04: a scan must
 * answer within ~8 s, never stall). Run: npm run test:visionbudget
 *
 * Pins: a call gets only the time left on the clock; a stalled call is cut at
 * the deadline and the read fails with the budget error; a fast failure is
 * retried once inside what remains; a slow failure is not retried; with no
 * time left nothing is even attempted; the second look needs 3 s left.
 */
import assert from "node:assert/strict";
import { ReadBudgetExceededError, SCAN_BUDGET_MS, SECOND_LOOK_MIN_MS, isBudgetError, remainingMs, withinBudget } from "../src/lib/visionBudget.ts";

let t = 0;
const now = () => t;
const B = SCAN_BUDGET_MS;
const clock = (startedAt = 0) => ({ startedAt, budgetMs: B, now });

// the attempt is handed the time left
t = 2_000;
let given = [];
assert.equal(await withinBudget(async (ms) => { given.push(ms); return "ok"; }, clock()), "ok");
assert.deepEqual(given, [B - 2_000]);

// a stalled call: the SDK times out at the deadline, the read fails with the budget error
t = 1_000;
given = [];
const timeout = () => { const e = new Error("Request timed out."); e.name = "APIConnectionTimeoutError"; return e; };
await assert.rejects(
  withinBudget(async (ms) => { given.push(ms); t += ms; throw timeout(); }, clock()),
  (e) => e instanceof ReadBudgetExceededError && isBudgetError(e),
);
assert.deepEqual(given, [B - 1_000], "cut once at the deadline, no retry after a timeout");

// a fast failure (overloaded) is retried once with the time then left
t = 0;
given = [];
let calls = 0;
const out = await withinBudget(async (ms) => { given.push(ms); calls++; if (calls === 1) { t += 300; throw new Error("overloaded"); } return "second"; }, clock());
assert.equal(out, "second");
assert.deepEqual(given, [B, B - 300]);

// a slow failure (most of the budget gone) is the answer, not retried
t = 0;
given = [];
await assert.rejects(withinBudget(async (ms) => { given.push(ms); t += B / 2; throw new Error("500"); }, clock()), /500/);
assert.deepEqual(given, [B]);

// a fast failure with nothing meaningful left is the budget error
t = B - 300;
await assert.rejects(withinBudget(async () => { t += 200; throw new Error("overloaded"); }, clock()), ReadBudgetExceededError);

// nothing is attempted with the clock run down
t = B - 200;
let attempted = false;
await assert.rejects(withinBudget(async () => { attempted = true; return 1; }, clock()), ReadBudgetExceededError);
assert.equal(attempted, false);

// the second look's floor and the clock arithmetic
t = B - 2_500;
assert.equal(remainingMs(clock()), 2_500);
assert.ok(remainingMs(clock()) < SECOND_LOOK_MIN_MS, "no second look with 2.5 s left");
t = B + 2_000;
assert.equal(remainingMs(clock()), 0);
assert.equal(isBudgetError({ name: "AbortError" }), true);
assert.equal(isBudgetError(new Error("x")), false);

console.log("test-vision-budget: ok");
