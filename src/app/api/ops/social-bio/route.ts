import { NextResponse, type NextRequest } from "next/server";
import { secretEqual } from "@/lib/server/secretEqual";
import { cronAuthError } from "@/lib/server/cronAuth";
import { blueskyCall, blueskyGet, blueskySession } from "@/lib/server/sites/bluesky";
import { metaReadCreds } from "@/lib/server/sites/meta";
import { pinterestAccessToken } from "@/lib/server/sites/pinterest";
import { xSignedForm, xSignedGet } from "@/lib/server/sites/x";
import { BIO_MAX, bioProblem, mergeBlueskyProfile, type BlueskyProfileRecord } from "@/lib/socialBio";

/**
 * Read and write the profile bio of each social account (Chris 09-30). The
 * credentials only live on Vercel, so this runs there; the GitHub workflow
 * social-bio.yml is the hand-operated dispatcher. Bearer CRON_SECRET or the
 * GitHub SOCIAL_POST_KEY, same as ebay-marketplaces (/api/ops sits outside
 * the US-only admin fence).
 *
 *   GET   -> { sites: [{ site, handle, bio, canWrite, note }] }   (a site that errors reports { error })
 *   POST  { dryRun?: boolean, bios: { bluesky: "...", x: "...", facebook: "..." } }
 *         -> { dryRun, sites: [{ site, before, after, written, ... }] }
 *
 * Writes exist for Bluesky (putRecord), X (v1.1 account/update_profile) and the
 * Facebook Page (about). Instagram, Threads, TikTok and Pinterest have no bio
 * write API. Any bio over its cap refuses the whole request with a 400.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GRAPH = process.env.META_GRAPH_BASE ?? "https://graph.facebook.com/v21.0";
const PINTEREST_API = process.env.PINTEREST_API_BASE ?? "https://api.pinterest.com";

interface Read {
  handle: string;
  bio: string;
}

interface Adapter {
  id: string;
  canWrite: boolean;
  note: string;
  read: () => Promise<Read>;
  write?: (bio: string) => Promise<void>;
}

const NOT_CONNECTED = "not connected (credentials missing)";

async function graphJson<T>(url: string, init: RequestInit | undefined, step: string): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  // Graph errors are returned verbatim so a missing permission is obvious.
  if (!res.ok) throw new Error(`${step} ${res.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text) as T;
}

async function xJson<T>(res: Response | null, step: string): Promise<T> {
  if (!res) throw new Error(NOT_CONNECTED);
  const text = await res.text();
  if (!res.ok) throw new Error(`x ${step} ${res.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text) as T;
}

const adapters: Adapter[] = [
  {
    id: "bluesky",
    canWrite: true,
    note: "Writes app.bsky.actor.profile/self via putRecord; avatar, banner and other fields are kept.",
    async read() {
      const s = await blueskySession();
      if (!s) throw new Error(NOT_CONNECTED);
      const p = await blueskyGet<{ handle?: string; displayName?: string; description?: string }>("app.bsky.actor.getProfile", { actor: s.did }, s);
      return { handle: [p.handle, p.displayName].filter(Boolean).join(" / "), bio: p.description ?? "" };
    },
    async write(bio) {
      const s = await blueskySession();
      if (!s) throw new Error(NOT_CONNECTED);
      let existing: { value?: BlueskyProfileRecord; cid?: string } | null = null;
      try {
        existing = await blueskyGet<{ value?: BlueskyProfileRecord; cid?: string }>(
          "com.atproto.repo.getRecord",
          { repo: s.did, collection: "app.bsky.actor.profile", rkey: "self" },
          s,
        );
      } catch (err) {
        // A brand-new account has no profile record yet; anything else is a real failure.
        if (!/RecordNotFound/.test(err instanceof Error ? err.message : "")) throw err;
      }
      await blueskyCall(
        "com.atproto.repo.putRecord",
        {
          repo: s.did,
          collection: "app.bsky.actor.profile",
          rkey: "self",
          record: mergeBlueskyProfile(existing?.value, bio),
          ...(existing?.cid ? { swapRecord: existing.cid } : {}),
        },
        s,
      );
    },
  },
  {
    id: "x",
    canWrite: true,
    note: "Writes via v1.1 account/update_profile.json with the same OAuth 1.0a user-context signer the poster uses. The v1.1 endpoint may be closed to the Free API tier; an X error is reported verbatim.",
    async read() {
      const j = await xJson<{ data?: { username?: string; name?: string; description?: string } }>(
        await xSignedGet("/2/users/me", { "user.fields": "description" }),
        "users/me",
      );
      return { handle: j.data?.username ? `@${j.data.username}` : "", bio: j.data?.description ?? "" };
    },
    async write(bio) {
      await xJson(await xSignedForm("/1.1/account/update_profile.json", { description: bio }), "update_profile");
    },
  },
  {
    id: "facebook",
    canWrite: true,
    note: "Writes the Page's `about` with the Page token (needs pages_manage_metadata); the Graph error is reported verbatim if the permission is missing.",
    async read() {
      const c = (await metaReadCreds()).facebook;
      if (!c) throw new Error(NOT_CONNECTED);
      const j = await graphJson<{ name?: string; about?: string; description?: string }>(
        `${c.base}/${c.pageId}?fields=name,about,description&access_token=${encodeURIComponent(c.token)}`,
        undefined,
        "facebook page",
      );
      return { handle: j.name ?? c.pageId, bio: j.about ?? "" };
    },
    async write(bio) {
      const c = (await metaReadCreds()).facebook;
      if (!c) throw new Error(NOT_CONNECTED);
      await graphJson(
        `${GRAPH}/${c.pageId}`,
        { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ about: bio, access_token: c.token }).toString() },
        "facebook about",
      );
    },
  },
  {
    id: "instagram",
    canWrite: false,
    note: "No bio-write API exists; by hand in the app.",
    async read() {
      const c = (await metaReadCreds()).instagram;
      if (!c) throw new Error(NOT_CONNECTED);
      const j = await graphJson<{ username?: string; biography?: string }>(
        `${c.base}/${c.userId}?fields=username,biography&access_token=${encodeURIComponent(c.token)}`,
        undefined,
        "instagram profile",
      );
      return { handle: j.username ? `@${j.username}` : "", bio: j.biography ?? "" };
    },
  },
  {
    id: "threads",
    canWrite: false,
    note: "No bio-write API exists; by hand in the app.",
    async read() {
      const c = (await metaReadCreds()).threads;
      if (!c) throw new Error(NOT_CONNECTED);
      const j = await graphJson<{ username?: string; threads_biography?: string }>(
        `${c.base}/${c.userId}?fields=username,threads_biography&access_token=${encodeURIComponent(c.token)}`,
        undefined,
        "threads profile",
      );
      return { handle: j.username ? `@${j.username}` : "", bio: j.threads_biography ?? "" };
    },
  },
  {
    id: "pinterest",
    canWrite: false,
    note: "Pinterest's public API has no profile-about write (user_account is read-only), so it is set by hand. Read needs the user_accounts:read scope, which the connect flow does not request today, so the read may come back as a 403.",
    async read() {
      const token = await pinterestAccessToken();
      if (!token) throw new Error("not connected (connect Pinterest on /admin/social)");
      const res = await fetch(`${PINTEREST_API}/v5/user_account`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`pinterest user_account ${res.status}: ${text.slice(0, 400)}`);
      const j = JSON.parse(text) as { username?: string; about?: string };
      return { handle: j.username ? `@${j.username}` : "", bio: j.about ?? "" };
    },
  },
  {
    id: "tiktok",
    canWrite: false,
    note: "app not approved",
    async read() {
      throw new Error("app not approved");
    },
  },
];

function authError(req: NextRequest) {
  const k = process.env.SOCIAL_POST_KEY;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return secretEqual(given, k) ? null : cronAuthError(req);
}

type SiteRow = { site: string; handle?: string; bio?: string; canWrite: boolean; note: string; error?: string };

async function readRow(a: Adapter): Promise<SiteRow> {
  if (a.id === "tiktok") return { site: a.id, canWrite: false, note: a.note };
  try {
    const r = await a.read();
    return { site: a.id, handle: r.handle, bio: r.bio, canWrite: a.canWrite, note: a.note };
  } catch (err) {
    return { site: a.id, canWrite: a.canWrite, note: a.note, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: NextRequest) {
  const denied = authError(req);
  if (denied) return denied;
  return NextResponse.json({ sites: await Promise.all(adapters.map(readRow)) });
}

export async function POST(req: NextRequest) {
  const denied = authError(req);
  if (denied) return denied;
  let body: { dryRun?: unknown; bios?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be JSON { dryRun?, bios: { site: text } }" }, { status: 400 });
  }
  const bios = body.bios;
  if (!bios || typeof bios !== "object" || Array.isArray(bios)) {
    return NextResponse.json({ error: "bios must be an object of { site: text }" }, { status: 400 });
  }
  const entries = Object.entries(bios as Record<string, unknown>);
  const known = new Set(adapters.map((a) => a.id));
  const problems = entries.flatMap(([site, text]) => {
    if (!known.has(site)) return [`${site}: unknown site (one of ${[...known].join(", ")})`];
    const p = bioProblem(site, text);
    return p ? [p] : [];
  });
  if (problems.length) return NextResponse.json({ error: "refused", problems, limits: BIO_MAX }, { status: 400 });

  const dryRun = body.dryRun === true;
  const rows = await Promise.all(
    entries.map(async ([site, text]) => {
      const a = adapters.find((x) => x.id === site)!;
      const bio = text as string;
      const before = await readRow(a);
      const row: Record<string, unknown> = { site, before: before.bio ?? null, requested: bio, canWrite: a.canWrite, note: a.note };
      if (!a.canWrite || !a.write) return { ...row, written: false, after: before.bio ?? null, skipped: "no bio-write API for this site" };
      if (dryRun) return { ...row, written: false, dryRun: true, after: bio };
      try {
        await a.write(bio);
      } catch (err) {
        return { ...row, written: false, after: before.bio ?? null, error: err instanceof Error ? err.message : String(err) };
      }
      const now = await readRow(a);
      return { ...row, written: true, after: now.bio ?? bio, ...(now.error ? { readbackError: now.error } : {}) };
    }),
  );
  return NextResponse.json({ dryRun, sites: rows });
}
