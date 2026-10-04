/**
 * One clock for a whole card read (Chris 10-04, after a scan sat on "Reading
 * the card" for over a minute: "it should time out or not found after about
 * 8 seconds of trying to read, but stalling in general is really bad, the
 * scanner is our main feature and needs to be flawless").
 *
 * The scan route starts the clock when the photo arrives; every model call
 * is given only the time left on it. A call that fails FAST (the API said
 * overloaded, a dropped socket) is tried once more inside what remains; a
 * call still running at the deadline is cut off and the read fails, which
 * gives the scan back and tells the seller to shoot again. The phone runs its
 * own, slightly longer clock (lib/client/visionApi.ts), so nothing on screen
 * can say "Reading" past the budget whatever the network does.
 */
export const SCAN_BUDGET_MS = 8_000;
/** A second look (the enlarged bottom strip) is worth starting only with this much left. */
export const SECOND_LOOK_MIN_MS = 3_000;
/** Under this there is no point starting a call at all. */
const MIN_ATTEMPT_MS = 500;
/** A failure this far short of its own timeout is a fast failure, worth one retry. */
const FAST_FAIL_RATIO = 0.4;

export class ReadBudgetExceededError extends Error {
  constructor(message = "card read ran out of time") {
    super(message);
    this.name = "ReadBudgetExceededError";
  }
}

export function isBudgetError(err: unknown): boolean {
  if (err instanceof ReadBudgetExceededError) return true;
  const name = (err as { name?: string } | null)?.name ?? "";
  // The Anthropic SDK's per-request timeout and an aborted fetch.
  return name === "APIConnectionTimeoutError" || name === "AbortError" || name === "TimeoutError";
}

export interface BudgetClock {
  startedAt: number;
  budgetMs?: number;
  now?: () => number;
}

/** Milliseconds left on the clock (never negative). */
export function remainingMs(clock: BudgetClock): number {
  return Math.max(0, (clock.budgetMs ?? SCAN_BUDGET_MS) - ((clock.now ?? Date.now)() - clock.startedAt));
}

/**
 * Run `attempt(timeoutMs)` with the time left on the clock. The attempt must
 * honour `timeoutMs` (the SDK's per-request timeout). A fast failure is
 * retried once with the time then left; a slow one is the answer.
 */
export async function withinBudget<T>(attempt: (timeoutMs: number) => Promise<T>, clock: BudgetClock): Promise<T> {
  const now = clock.now ?? Date.now;
  let left = remainingMs(clock);
  if (left < MIN_ATTEMPT_MS) throw new ReadBudgetExceededError();
  const t0 = now();
  try {
    return await attempt(left);
  } catch (err) {
    const took = now() - t0;
    left = remainingMs(clock);
    // The failure was the deadline itself, or there is no time to try again: the read is over.
    if (isBudgetError(err) || left < MIN_ATTEMPT_MS) throw new ReadBudgetExceededError(err instanceof Error ? `${err.name}: ${err.message}` : undefined);
    // A slow failure (most of the budget gone) is the answer; a fast one (overloaded, dropped socket) gets one more go.
    if (took > FAST_FAIL_RATIO * (clock.budgetMs ?? SCAN_BUDGET_MS)) throw err;
    return attempt(left);
  }
}
