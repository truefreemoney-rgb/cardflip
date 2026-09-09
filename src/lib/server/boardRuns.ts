import "server-only";

/**
 * What happened to a board task after ▶ Run (Chris, 09-09: "it should have
 * indicators after run, doesn't have to be live"). Read from GitHub when the
 * board page loads — no polling. One issues call per running task plus one
 * PR list for all of them; the runner's PR body starts with "Closes #n".
 */

export const BOARD_REPO = "truefreemoney-rgb/cardflip";

export type RunState = "running" | "needs-you" | "pr-ready" | "done" | "closed";

export interface RunStatus {
  state: RunState;
  /** Where to go: the PR when there is one, else the issue. */
  url: string;
  /** When the Run press opened the issue (ISO). */
  startedAt: string;
}

interface GhIssue {
  number: number;
  state: "open" | "closed";
  html_url: string;
  created_at: string;
  labels?: { name: string }[];
}
interface GhPull {
  number: number;
  state: "open" | "closed";
  html_url: string;
  body: string | null;
  merged_at: string | null;
}

async function gh<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${BOARD_REPO}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "cardflip-board" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function runStatuses(numbers: number[]): Promise<Record<number, RunStatus>> {
  const token = process.env.GITHUB_TOKEN;
  const out: Record<number, RunStatus> = {};
  const wanted = Array.from(new Set(numbers.filter((n) => Number.isInteger(n) && n > 0)));
  if (!token || wanted.length === 0) return out;

  const [pulls, ...issues] = await Promise.all([
    gh<GhPull[]>("/pulls?state=all&sort=created&direction=desc&per_page=50", token),
    ...wanted.map((n) => gh<GhIssue>(`/issues/${n}`, token)),
  ]);

  wanted.forEach((n, i) => {
    const issue = issues[i];
    if (!issue) return;
    // Several PRs can name the same issue (a duplicate run, a retry): the
    // merged one is the answer, else the open one, else the newest.
    const matches = (pulls ?? []).filter((p) => new RegExp(`^\\s*Closes #${n}\\b`, "i").test(p.body ?? ""));
    const pr = matches.find((p) => p.merged_at) ?? matches.find((p) => p.state === "open") ?? matches[0];
    const labels = new Set((issue.labels ?? []).map((l) => l.name));
    let state: RunState = "running";
    if (pr?.merged_at) state = "done";
    else if (issue.state === "closed") state = "closed";
    else if (labels.has("needs-chris")) state = "needs-you";
    else if (pr && pr.state === "open") state = "pr-ready";
    out[n] = { state, url: pr && state !== "needs-you" ? pr.html_url : issue.html_url, startedAt: issue.created_at };
  });
  return out;
}
