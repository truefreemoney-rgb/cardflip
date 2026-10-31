import { test, expect, type Page } from "@playwright/test";
import { guardNetwork, ledger, signup, dumpOnFailure } from "./helpers";

/**
 * Inventory (app/collection) on a phone (10-31): the rows a seller edits,
 * deletes and marks sold. Rows go in through POST /api/cards, the same call
 * a scan makes, so these run on a fresh clone with no catalog.
 */

async function addCard(page: Page, cardName: string, opts: { setName?: string; price?: number; verified?: boolean } = {}) {
  const res = await page.request.post("/api/cards", {
    data: { cardName, setName: opts.setName ?? "Fossil", cardNumber: "4", imageUrl: "", price: opts.price ?? 40, game: "pokemon" },
  });
  expect(res.status(), `create ${cardName}`).toBe(201);
  const { card } = await res.json();
  if (opts.verified) {
    // Mark as Sold waits for Verify (Chris 10-20: a wrong match would land in Sold at the wrong price).
    expect((await page.request.patch(`/api/cards/${card.id}`, { data: { verifiedAt: Date.now() } })).status()).toBe(200);
  }
  return card.id as string;
}

const isCardsCall = (method: string, path = "/api/cards") => (r: { method(): string; url(): string }) =>
  r.method() === method && new URL(r.url()).pathname.startsWith(path);

/** The card's label button in the grid (name, set, number, price): opens its sheet. */
const rowButton = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name} .*· #`) });

async function openInventory(page: Page, first: string) {
  await page.goto("/app/collection");
  await expect(rowButton(page, first)).toBeVisible({ timeout: 30_000 });
}

test.afterEach(dumpOnFailure);

test.describe("inventory", () => {
  test.beforeEach(async ({ page }) => {
    await guardNetwork(page);
    await signup(page);
  });

  test("edit condition on the card and the asking price from the selection bar", async ({ page }) => {
    const id = await addCard(page, "Dragonite");
    await openInventory(page, "Dragonite");

    await rowButton(page, "Dragonite").click();
    const sheet = page.getByRole("dialog", { name: "Dragonite details" });
    await expect(sheet).toBeVisible();
    const saved = page.waitForResponse((r) => isCardsCall("PATCH", `/api/cards/${id}`)(r.request()));
    await sheet.getByRole("combobox", { name: "Condition" }).selectOption("Lightly Played");
    expect((await saved).ok(), "condition saved").toBeTruthy();
    await sheet.getByRole("button", { name: "Close" }).first().click();

    await page.getByRole("checkbox", { name: "Select Dragonite" }).click();
    await page.getByRole("button", { name: "Set price" }).click();
    await page.getByRole("spinbutton", { name: "Asking price for the selected cards" }).fill("55.5");
    const priced = page.waitForResponse((r) => isCardsCall("PATCH", `/api/cards/${id}`)(r.request()));
    await page.getByRole("button", { name: "Apply to 1" }).click();
    expect((await priced).ok(), "price saved").toBeTruthy();

    const [row] = await ledger(page);
    expect([row.condition, row.price]).toEqual(["Lightly Played", 55.5]);
  });

  test("Delete on the card asks first: Cancel keeps it, Delete card removes it", async ({ page }) => {
    await addCard(page, "Dragonite");
    await openInventory(page, "Dragonite");

    await rowButton(page, "Dragonite").click();
    const sheet = page.getByRole("dialog", { name: "Dragonite details" });
    await sheet.getByRole("button", { name: "Delete", exact: true }).click();
    const ask = page.getByRole("alertdialog", { name: "Confirm" });
    await expect(ask).toContainText("Delete Dragonite (Fossil) from your Inventory?");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    await expect(sheet).toBeVisible();
    expect((await ledger(page)).map((r) => r.cardName), "Cancel deletes nothing").toEqual(["Dragonite"]);

    await sheet.getByRole("button", { name: "Delete", exact: true }).click();
    // The server delete waits out the Undo toast (5.5 s); wait for the call itself, not a clock.
    const gone = page.waitForRequest(isCardsCall("DELETE"));
    await ask.getByRole("button", { name: "Delete card" }).click();
    await expect(rowButton(page, "Dragonite")).toHaveCount(0);
    await gone;
    await expect.poll(async () => (await ledger(page)).length).toBe(0);
  });

  // Bug (10-31): the row × deletes with only an Undo toast; Chris 10-22 wanted an "are you sure" on delete, the card sheet's has it.
  test("the row × asks before deleting", async ({ page }) => {
    test.fail();
    await addCard(page, "Dragonite");
    await openInventory(page, "Dragonite");
    await page.getByRole("button", { name: "Delete Dragonite", exact: true }).click();
    await expect(page.getByRole("alertdialog", { name: "Confirm" }), "an are-you-sure before the card goes").toBeVisible({ timeout: 3_000 });
  });

  test("bulk select + delete removes exactly the selected cards", async ({ page }) => {
    await addCard(page, "Dragonite");
    await addCard(page, "Machamp", { setName: "Base Set" });
    await addCard(page, "Pikachu", { setName: "Base Set" });
    await openInventory(page, "Pikachu");

    await page.getByRole("checkbox", { name: "Select Dragonite" }).click();
    await page.getByRole("checkbox", { name: "Select Machamp" }).click();
    const gone = page.waitForRequest(isCardsCall("DELETE"));
    // No are-you-sure here today (see the test.fail below); once one is added, confirm it at this step.
    await page.getByRole("button", { name: "Delete 2 cards" }).click();
    await expect(rowButton(page, "Dragonite")).toHaveCount(0);
    await expect(rowButton(page, "Machamp")).toHaveCount(0);
    await expect(rowButton(page, "Pikachu")).toBeVisible();
    expect((await gone).postDataJSON().ids, "only the two ticked").toHaveLength(2);
    await expect.poll(async () => (await ledger(page)).map((r) => r.cardName)).toEqual(["Pikachu"]);
  });

  // Bug (10-31): bulk "Delete N cards" removes with only an Undo toast, no are-you-sure (same rule as the row ×).
  test("bulk Delete asks before deleting", async ({ page }) => {
    test.fail();
    await addCard(page, "Dragonite");
    await addCard(page, "Machamp", { setName: "Base Set" });
    await openInventory(page, "Machamp");
    await page.getByRole("checkbox", { name: "Select Dragonite" }).click();
    await page.getByRole("checkbox", { name: "Select Machamp" }).click();
    await page.getByRole("button", { name: "Delete 2 cards" }).click();
    await expect(page.getByRole("alertdialog", { name: "Confirm" }), "an are-you-sure before two cards go").toBeVisible({ timeout: 3_000 });
  });

  test("Mark as Sold by hand asks twice, then the card is in Sold with its net line", async ({ page }) => {
    await addCard(page, "Machamp", { setName: "Base Set", price: 12 });
    const id = await addCard(page, "Dragonite", { verified: true });
    await openInventory(page, "Dragonite");

    // An unverified card can't be marked sold (Chris 10-20).
    await rowButton(page, "Machamp").click();
    const machamp = page.getByRole("dialog", { name: "Machamp details" });
    await expect(machamp.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    await expect(machamp.getByRole("button", { name: "Mark as Sold" })).toHaveCount(0);
    await machamp.getByRole("button", { name: "Close" }).first().click();

    await rowButton(page, "Dragonite").click();
    await page.getByRole("dialog", { name: "Dragonite details" }).getByRole("button", { name: "Mark as Sold" }).click();
    const sheet = page.getByRole("dialog", { name: "Mark Dragonite as sold" });
    await sheet.getByRole("button", { name: "Mark as Sold" }).click();
    // Second step (Chris 10-08): a sold record can't be undone, so nothing is written yet.
    await expect(sheet.getByText("Are you sure?")).toBeVisible();
    await expect(sheet).toContainText("This marks it sold for $40.00");
    expect((await ledger(page)).find((r) => r.id === id)?.status).toBe("ready");
    const saved = page.waitForResponse((r) => isCardsCall("PATCH", `/api/cards/${id}`)(r.request()));
    await sheet.getByRole("button", { name: "Yes, Mark as Sold" }).click();
    expect((await saved).ok()).toBeTruthy();

    // Sold by hand: no eBay fee or postage, so the net is the full $40.00.
    await expect(page.getByText("sold $40.00 · net")).toBeVisible();
    await expect(page.getByRole("button", { name: /Unsold .* Sold \$40\.00/ })).toBeVisible();
    const row = (await ledger(page)).find((r) => r.id === id) as { status: string; soldPrice?: number };
    expect([row.status, row.soldPrice]).toEqual(["sold", 40]);

    // It sits under the Sold filter, not Not Listed.
    await page.getByRole("button", { name: "Search, Sort & Filter" }).click();
    await page.getByRole("button", { name: "Sold", exact: true }).click();
    await expect(rowButton(page, "Dragonite")).toBeVisible();
    await expect(rowButton(page, "Machamp")).toHaveCount(0);
    await page.getByRole("button", { name: "Not Listed", exact: true }).click();
    await expect(rowButton(page, "Machamp")).toBeVisible();
    await expect(rowButton(page, "Dragonite")).toHaveCount(0);
  });
});
