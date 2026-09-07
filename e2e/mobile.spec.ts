import { test, expect, type Page } from "@playwright/test";

/**
 * The phone pass, automated (mobile QA 09-06/07). Each check here is one that
 * was a real defect: the header row that scrolled every /app page sideways,
 * 14px inputs that made iOS zoom, the camera error block hidden behind the
 * capture bar, the tour that has to run page to page and stamp once.
 */

const PASSWORD = "hunter22hunter";
const uniq = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Layout rules every screen must hold at 375px. */
async function expectMobileClean(page: Page, label: string) {
  const report = await page.evaluate(() => {
    const de = document.documentElement;
    const zoomers = [...document.querySelectorAll("input,select,textarea")]
      .filter((e) => !["hidden", "checkbox", "radio", "file"].includes((e as HTMLInputElement).type))
      .filter((e) => e.getBoundingClientRect().width > 0)
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16)
      .map((e) => `${e.tagName} ${(e as HTMLInputElement).placeholder || (e as HTMLElement).getAttribute("aria-label") || ""} ${getComputedStyle(e).fontSize}`);
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, zoomers };
  });
  expect(report.scrollWidth, `${label}: page scrolls sideways`).toBeLessThanOrEqual(report.clientWidth);
  expect(report.zoomers, `${label}: inputs under 16px (iOS zooms on focus)`).toEqual([]);
}

async function dismissTour(page: Page) {
  const close = page.getByRole("button", { name: "Close the tutorial" });
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function signup(page: Page) {
  const email = `e2e-${uniq()}@example.com`;
  const res = await page.request.post("/api/auth/signup", { data: { name: "E2E Phone", email, password: PASSWORD } });
  expect(res.status(), "signup").toBe(201);
  return email;
}

test.describe("anonymous", () => {
  for (const path of ["/", "/login", "/signup", "/forgot-password", "/pricing", "/help"]) {
    test(`${path} is clean at phone width`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectMobileClean(page, path);
    });
  }

  test("/app sends a stranger to /login", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("trial account", () => {
  test("header fits, every app page is clean, tour runs page to page and stamps once", async ({ page }) => {
    await signup(page);
    await page.goto("/app");

    // The tour opens for a new account. Walk it: every step advances with the
    // last non-Skip/Back button ("Next", "On to Inventory", …, "Bye, robot").
    const card = page.locator(".tour-card");
    await expect(card).toBeVisible({ timeout: 60_000 }); // first /app compile on a fresh clone is slow
    const visited = new Set<string>();
    const stepKey = async () => `${new URL(page.url()).pathname}|${(await card.innerText().catch(() => "")).slice(0, 80)}`;
    for (let i = 0; i < 16 && (await card.isVisible().catch(() => false)); i++) {
      visited.add(new URL(page.url()).pathname);
      const before = await stepKey();
      const buttons = card.getByRole("button").filter({ hasNotText: /^(✕|Skip|Back)$/ });
      const n = await buttons.count();
      expect(n, `tour step ${i} has an advance button`).toBeGreaterThan(0);
      await buttons.nth(n - 1).click();
      // Page-to-page steps navigate, and on a fresh clone the dev server
      // compiles each page on first visit — wait for the step to actually
      // change (or the tour to end) rather than a fixed pause.
      await expect
        .poll(async () => (await card.isVisible().catch(() => false)) ? await stepKey() : "done", { timeout: 45_000 })
        .not.toBe(before);
    }
    await expect(card).toHaveCount(0);
    expect([...visited]).toEqual(expect.arrayContaining(["/app", "/app/collection", "/app/price-check", "/app/wishlist"]));
    const me = await (await page.request.get("/api/auth/me")).json();
    expect(me.user.tourSeenAt, "tour stamped").toBeTruthy();

    // Once stamped it must not come back.
    await page.goto("/app");
    await expect(page.locator(".tour-card")).toHaveCount(0);

    // The header row that used to be 427px wide at 375.
    const header = page.locator("header");
    const hb = await header.boundingBox();
    expect(hb!.height, "header height").toBeLessThan(170);
    await expect(header.getByRole("link", { name: /Subscribe/ }).first()).toBeVisible();

    for (const path of ["/app", "/app/collection", "/app/price-check", "/app/wishlist", "/app/account", "/app/rewards"]) {
      await page.goto(path);
      await dismissTour(page);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectMobileClean(page, path);
    }
  });

  test("camera sheet with permission blocked shows the way out over the viewfinder", async ({ page, context }) => {
    await context.clearPermissions();
    await signup(page);
    await page.goto("/app");
    await dismissTour(page);
    await page.getByRole("button", { name: /Scan a Card/i }).click();
    const dialog = page.getByRole("dialog", { name: "Camera scanner" });
    await expect(dialog).toBeVisible();
    // No camera → the error state. Its buttons used to render below the video,
    // under the sticky capture bar; they must be inside the viewport.
    const choose = dialog.getByRole("button", { name: /Choose photos instead/ });
    await expect(choose).toBeVisible({ timeout: 15_000 });
    const box = await choose.boundingBox();
    const vh = page.viewportSize()!.height;
    expect(box!.y + box!.height, "fallback button inside the viewport").toBeLessThan(vh - 80);
    await expectMobileClean(page, "camera sheet");
  });

  test("post-scan editor opens from a ledger row and is clean", async ({ page }) => {
    await signup(page);
    const created = await page.request.post("/api/cards", {
      data: { cardName: "Charizard", setName: "Base Set", cardNumber: "4", imageUrl: "", price: 250, game: "pokemon" },
    });
    expect(created.status(), "create card").toBe(201);
    const { card } = await created.json();
    await page.goto(`/app?resume=${card.id}&rn=Charizard&rnum=4&rg=pokemon&ri=`);
    await dismissTour(page);
    await expect(page.getByText(/Is this your card\?/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Yes, this is my card/ })).toBeVisible();
    await expectMobileClean(page, "editor");
  });
});
