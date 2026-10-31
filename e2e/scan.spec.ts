import { test, expect } from "@playwright/test";
import { DRAGONITE, READS, SOL_RING, readOf } from "./fixtures/cards";
import { capture, enablePhotoInput, guardNetwork, ledger, mockScan, openScanner, scanBody, signup } from "./helpers";

/**
 * The paid scanner, end to end on a phone (10-31): photo in through the
 * dev-only input, the real pump in app/page.tsx, a mocked read, the real
 * save to the ledger. The shipped slips this pins: a read-in card dropped by
 * the watchdog (10-30, a customer lost 4 of 5 trial scans), a wrong-game
 * double read, empty outcomes that kept the scan or saved a row.
 */

test.describe("scanner", () => {
  test.beforeEach(async ({ page }) => {
    await enablePhotoInput(page);
  });

  test("a normal card shows its name and a green price, saves, and is in Inventory", async ({ page }) => {
    await guardNetwork(page);
    const scan = await mockScan(page);
    scan.reply({ read: readOf(DRAGONITE), match: [DRAGONITE] });
    await signup(page);
    const dialog = await openScanner(page);

    const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/cards");
    await capture(page, "Dragonite");
    expect((await saved).status(), "the card is saved").toBe(201);

    await expect(dialog.getByText("MATCH FOUND")).toBeVisible();
    await expect(dialog.getByText("Dragonite", { exact: true })).toBeVisible();
    // The count-up lands on the market to the cent, green (Chris 10-20: money is green).
    const price = dialog.getByTestId("reveal-price");
    await expect(price).toHaveText("$42.17");
    await expect(price).toHaveClass(/text-emerald/);
    expect(scan.givebacks, "a found card is not given back").toEqual([]);

    const rows = await ledger(page);
    expect(rows.map((r) => r.cardName)).toEqual(["Dragonite"]);

    await page.goto("/app/collection");
    await expect(page.getByText("Dragonite").first()).toBeVisible({ timeout: 30_000 });
  });

  // Each one says why, asks for the scan back, and leaves no ledger row (10-11, 10-31).
  const EMPTY: { name: string; read: (typeof READS)[keyof typeof READS]; game?: "mtg"; line: RegExp; giveback: boolean }[] = [
    { name: "graded slab", read: READS.slab, line: /^Graded slabs are coming soon\. Scan a raw card for now$/, giveback: true },
    { name: "sealed pack", read: READS.sealed, line: /^Packs and boxes are coming soon\. Scan a single card for now$/, giveback: true },
    { name: "unreadable photo", read: READS.unreadable, line: /^Couldn't read this card — retake/, giveback: true },
    // A switch is on offer: the read is held (the switch reuses it), given back only if cleared instead (10-22).
    { name: "another game's card", read: READS.otherGame, line: /^That looks like a Magic card$/, giveback: false },
    { name: "Magic token", read: READS.mtgToken, game: "mtg", line: /^That's a token — tokens aren't accepted/, giveback: true },
    { name: "Magic art card", read: READS.mtgArt, game: "mtg", line: /^That's an art card — art cards aren't accepted/, giveback: true },
  ];
  for (const c of EMPTY) {
    test(`${c.name}: says why, gives the scan back, saves nothing`, async ({ page }) => {
      await guardNetwork(page, { allGames: true });
      const scan = await mockScan(page);
      scan.reply({ read: c.read });
      await signup(page);
      if (c.game) await page.addInitScript((g) => localStorage.setItem("cardflip.game", g), c.game);
      const posts: string[] = [];
      page.on("request", (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/cards" && posts.push(r.url()));
      const dialog = await openScanner(page);

      const giveback = c.giveback ? page.waitForRequest("**/api/vision/scan/giveback") : null;
      await capture(page);
      await expect(dialog.getByText(c.line)).toBeVisible();
      if (giveback) await giveback;
      expect(scan.scans.map((s) => s.game)).toEqual([c.game ?? "pokemon"]);
      expect(scan.givebacks.length, "give-back asked").toBe(c.giveback ? 1 : 0);
      if (c.read === READS.otherGame) await expect(dialog.getByRole("button", { name: "Switch to Magic" })).toBeVisible();
      expect(posts, "no card saved").toEqual([]);
      expect(await ledger(page)).toEqual([]);
    });
  }

  /**
   * 10-30 (Lucas: 5 trial scans, 1 card): on a weak signal the read landed late,
   * the 35 s watchdog fired while the card was still being matched, and the
   * read-in card was dropped. A read that slow comes back without a prefetch
   * (the route skips it past 6 s), so the phone searches the catalog itself,
   * and that lookup is what straddles the watchdog here. The clock is the
   * page's own (page.clock fakes setTimeout AND AbortSignal.timeout): 37 s of
   * scanner time, no real waiting. The read lands at 29 s, inside the scan
   * request's 30 s limit; the lookup is held past 35 s, inside its own 15 s.
   */
  test("slow scan: a card read in just before the limit is never dropped by the watchdog", async ({ page }) => {
    await guardNetwork(page);
    const scan = await mockScan(page);
    let releaseRead!: () => void;
    const readHeld = new Promise<void>((r) => (releaseRead = r));
    scan.reply(async (route, body, scanId) => {
      await readHeld;
      await route.fulfill({ json: scanBody(readOf(DRAGONITE), body.game, scanId) });
    });
    let releaseLookup!: () => void;
    const lookupHeld = new Promise<void>((r) => (releaseLookup = r));
    await page.route("**/api/search-card?**", async (route) => {
      await lookupHeld;
      await route.fulfill({ json: { cards: [DRAGONITE] } });
    });
    await page.clock.install();
    await signup(page);
    const dialog = await openScanner(page);

    await capture(page);
    await expect(dialog.getByText("Reading the card…")).toBeVisible();
    await page.clock.fastForward(29_000);
    const lookupSent = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/search-card");
    releaseRead();
    await lookupSent;
    // Past the 35 s watchdog while the lookup is still out.
    await page.clock.fastForward(8_000);
    await expect(dialog.getByText("Took too long")).toHaveCount(0);
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/cards");
    releaseLookup();
    expect((await saved).status()).toBe(201);

    await expect(dialog.getByText("MATCH FOUND")).toBeVisible();
    await expect(dialog.getByText("Dragonite", { exact: true })).toBeVisible();
    expect(scan.givebacks, "a read-in card is not handed back").toEqual([]);
    // Not deleted as an orphan behind the seller's back either (the old watchdog path).
    await expect.poll(async () => (await ledger(page)).map((r) => r.cardName)).toEqual(["Dragonite"]);
  });
});

test.describe("game switch on the scanner", () => {
  test.beforeEach(async ({ page }) => {
    await enablePhotoInput(page);
    await guardNetwork(page, { allGames: true });
    // A fresh clone has no Magic mirror: the catalog answers Sol Ring for a Magic lookup, nothing for anything else.
    await page.route("**/api/search-card?**", (route) => {
      const q = new URL(route.request().url()).searchParams;
      return route.fulfill({ json: { cards: q.get("game") === "mtg" && /sol ring/i.test(q.get("name") ?? "") ? [SOL_RING] : [] } });
    });
  });

  test("another game's card: Switch reuses the same read (one paid scan) and saves it as that game", async ({ page }) => {
    const scan = await mockScan(page);
    scan.reply({ read: READS.otherGame });
    await signup(page);
    const dialog = await openScanner(page);

    await capture(page);
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/cards");
    await dialog.getByRole("button", { name: "Switch to Magic" }).click();
    expect((await saved).status()).toBe(201);
    await expect(dialog.getByText("Sol Ring", { exact: true })).toBeVisible();
    // 10-22 (Chris: "should only be 1 scan"): the photo is not read a second time.
    expect(scan.scans, "one read for the whole switch").toHaveLength(1);
    expect(scan.givebacks, "the switched read became the card, nothing to give back").toEqual([]);
    await expect(dialog.getByRole("radio", { name: "Magic" })).toHaveAttribute("aria-checked", "true");
    const rows = await ledger(page);
    expect(rows.map((r) => [r.cardName, (r as { game?: string }).game])).toEqual([["Sol Ring", "mtg"]]);
  });

  test("switching tabs mid-scan keeps the card on its own game and sends one read per capture", async ({ page }) => {
    const scan = await mockScan(page);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    scan.reply(
      async (route, body, scanId) => {
        await held;
        await route.fulfill({ json: scanBody(readOf(DRAGONITE), body.game, scanId, [DRAGONITE]) });
      },
      { read: readOf(SOL_RING), match: [SOL_RING] },
    );
    await signup(page);
    const dialog = await openScanner(page);
    const tabs = dialog.getByRole("radiogroup", { name: "Card game" });
    await expect(tabs.getByRole("radio", { name: "Pokémon" })).toHaveAttribute("aria-checked", "true");

    await capture(page, "Dragonite");
    // The seller flips to Magic while the Pokémon card is still being read.
    await tabs.getByRole("radio", { name: "Magic" }).click();
    await expect(tabs.getByRole("radio", { name: "Magic" })).toHaveAttribute("aria-checked", "true");
    const firstSaved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/cards");
    release();
    expect((await firstSaved).status()).toBe(201);
    await expect(dialog.getByText("Dragonite", { exact: true })).toBeVisible();

    const secondSaved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/cards");
    await capture(page, "Sol Ring");
    expect((await secondSaved).status()).toBe(201);
    await expect(dialog.getByText("Sol Ring", { exact: true })).toBeVisible();

    expect(scan.scans.map((s) => s.game), "one read per capture, each under the game it was taken in").toEqual(["pokemon", "mtg"]);
    const rows = await ledger(page);
    expect(rows.map((r) => `${r.cardName}:${(r as { game?: string }).game}`).sort()).toEqual(["Dragonite:pokemon", "Sol Ring:mtg"]);
  });
});
