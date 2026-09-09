import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { loadBoard, saveBoard } from "@/lib/server/board";

const REPO = "truefreemoney-rgb/cardflip";
const LABEL = "board-run";

/**
 * Run button on a board task (Chris, 09-09: "click a task, click Run, it
 * should push it to Claude and do the task"). Opens a GitHub issue labelled
 * `board-run`; the "CardFlip board runner" cloud routine picks it up, does
 * the work on a branch and opens a PR. The task line is prefixed with the
 * issue number so the board shows it is in flight. Needs GITHUB_TOKEN
 * (repo scope) in the Vercel environment.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const token = process.env.GITHUB_TOKEN;
    if (!token) return NextResponse.json({ error: "Set GITHUB_TOKEN on Vercel to enable Run." }, { status: 503 });
    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const { sections } = await loadBoard();
    const item = sections.flatMap((s) => s.items).find((i) => i.id === id);
    if (!item) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (item.done) return NextResponse.json({ error: "That task is completed" }, { status: 409 });
    // A re-run (Chris replied to the runner's question, or the last run was
    // closed): the old issue is superseded — close it so the runner can't pick
    // it up again — and the new one carries the whole thread.
    const prev = /^▶ RUNNING #(\d+) — ([\s\S]*)$/.exec(item.text);
    const text = prev ? prev[2] : item.text;
    if (prev) {
      await fetch(`https://api.github.com/repos/${REPO}/issues/${prev[1]}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "cardflip-board" },
        body: JSON.stringify({ state: "closed", state_reason: "not_planned", labels: [LABEL] }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
    const firstLine = text.split(/\r?\n/)[0];
    const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
    const gh = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "cardflip-board" },
      body: JSON.stringify({ title, labels: [LABEL], body: `Board task from the admin console.\n\n${text}${(item.images ?? []).map((u) => `\n\n![photo](${u})`).join("")}\n\n_Opened by the Run button; the board runner routine picks this up._` }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await gh.json().catch(() => ({}))) as { number?: number; html_url?: string; message?: string };
    if (!gh.ok || !data.number) {
      console.error("board run: GitHub issue failed", gh.status, data.message);
      return NextResponse.json({ error: `GitHub said no (${gh.status}${data.message ? `: ${data.message}` : ""})` }, { status: 502 });
    }
    item.text = `▶ RUNNING #${data.number} — ${text}`;
    await saveBoard(sections);
    return NextResponse.json({ sections, issue: data.number, url: data.html_url });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("board run failed:", err);
    return NextResponse.json({ error: "Couldn't start the task" }, { status: 500 });
  }
}
