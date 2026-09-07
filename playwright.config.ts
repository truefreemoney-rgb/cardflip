import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile E2E against a real dev server. Run: npm run test:e2e
 *
 * Chromium only, at a phone viewport — the point is the flows and the
 * layout rules (no sideways scroll, no iOS zoom-sized inputs), not browser
 * engines. The dev server uses whatever data/cardflip.db is present: a fresh
 * clone has no mirror (search returns nothing) and the specs tolerate that;
 * accounts are created per run with unique emails.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ...devices["iPhone 13"],
    // Chromium at a phone size; the WebKit engine isn't installed in CI.
    defaultBrowserType: "chromium",
    trace: "retain-on-failure",
    // Camera permission is deliberately NOT granted: the scanner's blocked-
    // permission state is one of the screens under test.
  },
  projects: [{ name: "mobile-chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
