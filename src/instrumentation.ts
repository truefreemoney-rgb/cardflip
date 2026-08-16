/**
 * Server start hook (Next.js instrumentation). While the machine is awake,
 * check once an hour whether the daily price refresh is due and run it —
 * so a busy day updates itself without any external pinger, and a machine
 * that was suspended mid-run picks the job back up. Server runtime only,
 * never during `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { runDailyIfDue } = await import("@/lib/server/dailyJobs");
  const tick = () => {
    runDailyIfDue().catch((err) => console.error("daily tick failed:", err));
  };
  // First check a minute after boot (let the seed import + warmup finish),
  // then hourly.
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 60 * 60_000).unref();
}
