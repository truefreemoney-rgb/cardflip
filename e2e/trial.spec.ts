import { test, expect, type Page } from "@playwright/test";
import { DRAGONITE, READS, readOf } from "./fixtures/cards";
import { cardPhoto, enablePhotoInput, guardNetwork, dumpOnFailure } from "./helpers";
import type { VisionCardRead } from "../src/lib/types";

/**
 * The free scan page (/scan, components/TrialScanner) signed out, on a phone
 * (10-31). The trial read is mocked; the page matches it itself through
 * /api/search-card (it does not use the prefetch), so that is answered here
 * too. A slab or a pack says "coming soon" and must leave the free try
 * unspent: the page offers the camera again and the next capture goes out.
 */

async function mockTrial(page: Page) {
  const reads: VisionCardRead[] = [];
  const sent: number[] = [];
  await page.route("**/api/vision/trial", async (route) => {
    sent.push(Date.now());
    const read = reads.length > 1 ? reads.shift()! : reads[0];
    await route.fulfill({ json: { status: "done", card: { game: "pokemon", ...read } } });
  });
  await page.route("**/api/search-card?**", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    return route.fulfill({ json: { cards: /dragonite/i.test(name) ? [DRAGONITE] : [] } });
  });
  return { reads, sent };
}

async function scanOnce(page: Page) {
  await page.getByRole("button", { name: /^(Scan a Pokémon Card|Try Again)$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Camera scanner" });
  await expect(dialog.locator("input[data-dbg-capture]")).toBeAttached({ timeout: 30_000 });
  const reply = page.waitForResponse("**/api/vision/trial");
  await dialog.locator("input[data-dbg-capture]").setInputFiles(await cardPhoto(page));
  return { dialog, reply: await reply };
}

const trialDone = (page: Page) => page.evaluate(() => localStorage.getItem("cardflip.trialDone"));

test.afterEach(dumpOnFailure);

test.describe("free scan page, signed out", () => {
  test.beforeEach(async ({ page }) => {
    await enablePhotoInput(page);
    await guardNetwork(page);
  });

  test("a read shows the card and its price, and the free try is spent", async ({ page }) => {
    const trial = await mockTrial(page);
    trial.reads.push(readOf(DRAGONITE));
    await page.goto("/scan");
    const { dialog } = await scanOnce(page);
    await expect(dialog.getByText("MATCH FOUND")).toBeVisible();

    // The camera hands over to the page (REVEAL_MS): name, set line, the market price.
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Dragonite", { exact: true })).toBeVisible();
    await expect(page.getByText("Fossil · #4")).toBeVisible();
    await expect(page.getByText("$42.17", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Save It \+ \d+ Free Scans$/ })).toBeVisible();
    expect(await trialDone(page), "a priced card uses the free scan").toBe("1");
  });

  for (const c of [
    { name: "graded slab", read: READS.slab, line: "Graded slabs are coming soon. Try a raw card" },
    { name: "sealed pack", read: READS.sealed, line: "Packs and boxes are coming soon. Try a single card" },
  ]) {
    test(`a ${c.name} says coming soon and leaves the free try for the next card`, async ({ page }) => {
      const trial = await mockTrial(page);
      trial.reads.push(c.read, readOf(DRAGONITE));
      await page.goto("/scan");

      const first = await scanOnce(page);
      expect((await first.reply.json()).card[c.read.slab ? "slab" : "kind"]).toBe(c.read.slab ? true : "sealed");
      await expect(page.getByRole("alert").filter({ hasText: c.line })).toHaveText(c.line);
      expect(await trialDone(page), "not counted as the free scan").toBeNull();

      // Not counted (Chris 10-31): the camera is offered again and the next photo is really read.
      const second = await scanOnce(page);
      expect(trial.sent, "a second read went out").toHaveLength(2);
      await expect(second.dialog).toHaveCount(0);
      await expect(page.getByText("$42.17", { exact: true })).toBeVisible();
      expect(await trialDone(page)).toBe("1");
    });
  }
});
