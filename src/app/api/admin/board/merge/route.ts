import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { BOARD_REPO, ghHeaders } from "@/lib/server/boardRuns";

/**
 * Merge a board runner's PR from the board (Chris, 09-09: "I don't want
 * things interconnected — everything on cardflip"). POST {number} → merges
 * PR #number into main through the same GITHUB_TOKEN the Run button uses;
 * Vercel deploys main on its own. Admin only; only PRs on this repo whose
 * head branch is a runner branch (board/…), so this can't merge anything
 * a person opened by hand.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const token = process.env.GITHUB_TOKEN;
    if (!token) return NextResponse.json({ error: "Set GITHUB_TOKEN on Vercel to enable Merge." }, { status: 503 });
    const body = await req.json().catch(() => null);
    const number = Number(body?.number);
    if (!Number.isInteger(number) || number <= 0) return NextResponse.json({ error: "Bad PR number" }, { status: 400 });

    const prRes = await fetch(`https://api.github.com/repos/${BOARD_REPO}/pulls/${number}`, { headers: ghHeaders(token), cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!prRes.ok) return NextResponse.json({ error: "Couldn't find that PR" }, { status: 404 });
    const pr = (await prRes.json()) as { state: string; merged: boolean; mergeable: boolean | null; mergeable_state?: string; head: { ref: string; sha: string }; title: string };
    if (pr.merged) return NextResponse.json({ ok: true, alreadyMerged: true });
    if (pr.state !== "open") return NextResponse.json({ error: "That PR is closed" }, { status: 409 });
    if (!/^board\//.test(pr.head.ref)) return NextResponse.json({ error: "Only board runner PRs can be merged from here" }, { status: 403 });
    if (pr.mergeable === false) return NextResponse.json({ error: "GitHub says this PR has conflicts — it needs a fresh run" }, { status: 409 });

    // Check the MERGED result, not just the branch (09-09: a green PR still
    // broke main after merging because its base was stale). A branch behind
    // main is brought up to date first — GitHub merges main into it, CI
    // re-runs — and the merge waits for that. Then every check on the head
    // has to be green before the button does anything.
    if (pr.mergeable_state === "behind") {
      const upd = await fetch(`https://api.github.com/repos/${BOARD_REPO}/pulls/${number}/update-branch`, {
        method: "PUT",
        headers: { ...ghHeaders(token), "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      });
      if (!upd.ok && upd.status !== 202) return NextResponse.json({ error: "This branch is behind main and GitHub couldn't update it — it needs a fresh run" }, { status: 409 });
      return NextResponse.json({ error: "Brought the branch up to date with main — the checks are re-running. Press Merge again in a few minutes." }, { status: 409 });
    }
    const checksRes = await fetch(`https://api.github.com/repos/${BOARD_REPO}/commits/${pr.head.sha}/check-runs?per_page=50`, { headers: ghHeaders(token), cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const checks = (await checksRes.json().catch(() => ({}))) as { check_runs?: { name: string; status: string; conclusion: string | null }[] };
    const runs = (checks.check_runs ?? []).filter((c) => !/vercel/i.test(c.name));
    if (runs.length === 0) return NextResponse.json({ error: "The checks haven't started on this branch yet — press Merge again in a minute." }, { status: 409 });
    const pending = runs.filter((c) => c.status !== "completed");
    if (pending.length) return NextResponse.json({ error: `Checks still running (${pending.map((c) => c.name).join(", ")}) — press Merge again when they're green.` }, { status: 409 });
    const red = runs.filter((c) => !["success", "skipped", "neutral"].includes(c.conclusion ?? ""));
    if (red.length) return NextResponse.json({ error: `Checks failed (${red.map((c) => c.name).join(", ")}) — this needs a fresh run, not a merge.` }, { status: 409 });

    const res = await fetch(`https://api.github.com/repos/${BOARD_REPO}/pulls/${number}/merge`, {
      method: "PUT",
      headers: { ...ghHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ merge_method: "merge", commit_title: `Merge pull request #${number}: ${pr.title}` }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { merged?: boolean; sha?: string; message?: string };
    if (!res.ok || !data.merged) return NextResponse.json({ error: data.message ?? "GitHub refused the merge" }, { status: 502 });
    return NextResponse.json({ ok: true, sha: data.sha });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("board merge failed:", err);
    return NextResponse.json({ error: "Couldn't merge" }, { status: 500 });
  }
}
