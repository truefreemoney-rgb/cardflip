import { expect, type Page, type Request, type Route, type TestInfo } from "@playwright/test";
import { buildSearchParams, printedKeyFromRead } from "../src/lib/searchParams";
import { mtgCuesOf } from "../src/lib/mtgCues";
import type { GameId, PokemonCard, VisionCardRead } from "../src/lib/types";

/**
 * Shared by the phone specs (10-31). Everything that would reach a paid or
 * outside service is answered here with page.route: the vision reads, the
 * give-back, the tiebreak, eBay. Every other host is aborted outright, so a
 * new outside call shows up as a failed request in the trace, never as a real
 * one from CI.
 */

export const PASSWORD = "hunter22hunter";
export const uniq = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * A fresh account. Unless a test is ABOUT the tour, it is stamped as seen
 * here: the overlay mounts after the session loads, so a one-shot "is the
 * close button visible?" could miss it and the next click landed on the
 * overlay instead (CI 09-08: "Scan a Card" click timed out, twice).
 */
export async function signup(page: Page, opts: { tour?: boolean } = {}) {
  const email = `e2e-${uniq()}@example.com`;
  // Signup allows 20 per IP per 10 minutes (LIMITS.authAttempt) and one run makes ~40 accounts (10-31). Off Vercel
  // the server reads the client IP from fly-client-ip (lib/server/rateLimit.ts clientIp), so each account comes
  // from its own loopback address: its own bucket, and loopback is never shut out or counted toward the alarm.
  const ip = `127.${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 250)}`;
  const res = await page.request.post("/api/auth/signup", { data: { name: "E2E Phone", email, password: PASSWORD }, headers: { "fly-client-ip": ip } });
  expect(res.status(), "signup").toBe(201);
  if (!opts.tour) {
    const seen = await page.request.post("/api/account/tour");
    expect(seen.status(), "stamp the tour as seen").toBe(200);
  }
  return email;
}

export async function dismissTour(page: Page) {
  const close = page.getByRole("button", { name: "Close the tutorial" });
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** The give-back as the server would answer a refund: same balance, nothing spent. */
const BALANCE = { used: 0, included: 5, remaining: 5 };

export interface ScanMock {
  /** Every POST /api/vision/scan body the page sent. */
  scans: { game: GameId }[];
  /** Every scan id the page asked to have back. */
  givebacks: string[];
  /** Set the next replies (one per scan, last one repeats). */
  reply: (...replies: ScanReply[]) => void;
}

/** One mocked read: the read itself, the card the catalog would match (prefetch), or a hand-held reply. */
export type ScanReply =
  | { read: VisionCardRead; match?: PokemonCard[]; game?: GameId }
  | ((route: Route, body: { game: GameId }, scanId: string) => Promise<void>);

/**
 * The scan reply the route sends (api/vision/scan): status, read, scanId and the
 * prefetch, keyed exactly as scanPrefetch.ts keys it so the scanner trusts it.
 */
export function scanBody(read: VisionCardRead, game: GameId, scanId: string, match?: PokemonCard[]) {
  const printed = printedKeyFromRead(read, game);
  const params = buildSearchParams(read.name, printed, "en", undefined, game, read.artStyle ?? null, false, read.firstEdition ?? null, game === "mtg" ? mtgCuesOf(read) : null);
  return { status: "done", card: { game, ...read }, scanId, ...(match ? { prefetch: { params: params.toString(), cards: match } } : {}) };
}

/**
 * No outside host, no paid route. Call before the first goto. Also opens every
 * game in the session (features come from settings rows a fresh clone does not
 * have; production has them on), so the game tabs and "Switch to" buttons show.
 */
export async function guardNetwork(page: Page, opts: { allGames?: boolean } = {}) {
  const lines: string[] = [];
  pageLogs.set(page, lines);
  page.on("pageerror", (e) => lines.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && lines.push(`console.error: ${m.text().slice(0, 300)}`));
  await page.context().route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => route.abort("blockedbyclient"),
  );
  await page.route("**/api/ebay/**", (route) =>
    route.fulfill({ status: 503, json: { status: "unconfigured", comps: null, sold: null, soldStatus: "unconfigured" } }),
  );
  await page.route("**/api/vision/tiebreak", (route) => route.fulfill({ json: { id: null } }));
  // Stripe and email are server-side only and CI has no keys for them; checkout is never clicked here.
  for (const path of ["**/api/billing/**", "**/api/stripe/**", "**/api/psa/**"]) {
    await page.route(path, (route) => route.fulfill({ status: 503, json: { error: "not in tests" } }));
  }
  if (opts.allGames) {
    await page.route("**/api/auth/me", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      if (body?.user?.features) for (const k of Object.keys(body.user.features)) body.user.features[k] = true;
      await route.fulfill({ response: res, json: body });
    });
  }
}

const pageLogs = new WeakMap<Page, string[]>();

/**
 * test.afterEach: on a failure, what the phone showed (aria snapshot) and its
 * page errors go into the CI log itself. The trace sits in the report
 * artifact, a download away; this is readable from the run page (10-31,
 * the first WebKit run of these specs).
 */
export async function dumpOnFailure({ page }: { page: Page }, testInfo: TestInfo) {
  if (testInfo.status === testInfo.expectedStatus) return;
  const snap = await page.locator("body").ariaSnapshot({ timeout: 5_000 }).catch((e) => `no snapshot: ${e}`);
  const errors = (pageLogs.get(page) ?? []).slice(-20).join("\n") || "(none)";
  console.log(`--- ${testInfo.title} [${testInfo.project.name}] at ${page.url()}\n${snap.slice(0, 4_000)}\n--- page errors:\n${errors}\n---`);
}

/** Mocks the paid scan and its give-back. Replies are consumed in order; the last one repeats. */
export async function mockScan(page: Page): Promise<ScanMock> {
  const mock: ScanMock = { scans: [], givebacks: [], reply: () => {} };
  let queue: ScanReply[] = [];
  mock.reply = (...replies) => {
    queue = replies;
  };
  let n = 0;
  await page.route("**/api/vision/scan", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { game: GameId };
    mock.scans.push({ game: body.game });
    const scanId = `e2e-scan-${++n}-${uniq()}`;
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (!next) throw new Error("mockScan: no reply set");
    if (typeof next === "function") return next(route, body, scanId);
    await route.fulfill({ json: scanBody(next.read, next.game ?? body.game ?? "pokemon", scanId, next.match) });
  });
  await page.route("**/api/vision/scan/giveback", async (route) => {
    const { scanId } = route.request().postDataJSON() as { scanId: string };
    mock.givebacks.push(scanId);
    await route.fulfill({ json: { refunded: true, reason: "refunded", usage: BALANCE } });
  });
  return mock;
}

/**
 * The dev-only photo input on the camera sheet (components/CameraOutlineDebug,
 * ?dbg=outline, sticky in localStorage) runs the real capture path with no
 * camera, on Chromium and WebKit alike. Production never loads it.
 */
export async function enablePhotoInput(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("cf:dbg", "outline");
    } catch {
      // A page with no storage simply has no debug input; the test then fails on the missing input.
    }
  });
}

/** A card-shaped JPEG drawn on a canvas in the page: no real photo of anyone's card. */
export async function cardPhoto(page: Page, label = "E2E"): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const dataUrl = await page.evaluate((text) => {
    const c = document.createElement("canvas");
    c.width = 630;
    c.height = 880;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1d2433";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#f2c94c";
    g.fillRect(30, 30, 570, 820);
    g.fillStyle = "#7aa7d8";
    g.fillRect(70, 140, 490, 340);
    g.fillStyle = "#111";
    g.font = "bold 44px sans-serif";
    g.fillText(text, 70, 105);
    g.font = "28px sans-serif";
    g.fillText("4/62", 470, 820);
    return c.toDataURL("image/jpeg", 0.9);
  }, label);
  return { name: `${label}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
}

/** Opens the camera sheet from /app and returns it. */
export async function openScanner(page: Page) {
  await page.goto("/app");
  await dismissTour(page);
  // dd63f28 named the game on the button ("Scan Pokémon Cards", "Scan Magic Cards").
  await page.getByRole("button", { name: /Scan (a Card|\S+ Cards)/i }).first().click();
  const dialog = page.getByRole("dialog", { name: "Camera scanner" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("input[data-dbg-capture]")).toBeAttached({ timeout: 30_000 });
  return dialog;
}

/** One capture through the photo input; resolves once the page has sent the scan request. */
export async function capture(page: Page, label = "E2E"): Promise<Request> {
  const photo = await cardPhoto(page, label);
  const sent = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/vision/scan");
  await page.locator("input[data-dbg-capture]").setInputFiles(photo);
  return sent;
}

/** The account's ledger rows, straight from the API (what Inventory lists). */
export async function ledger(page: Page): Promise<{ id: string; cardName: string; status: string; condition: string; price: number }[]> {
  const res = await page.request.get("/api/cards");
  expect(res.ok(), "GET /api/cards").toBeTruthy();
  const body = await res.json();
  return body.cards ?? [];
}
