import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile E2E against a real dev server. Run: npm run test:e2e
 *
 * Two phones (09-09, Chris: "I can't have unhappy Android customers because
 * I can't see it"): a Pixel 7 on Chromium = Android Chrome, and an iPhone 13
 * on WebKit = Safari's engine. Same specs, both engines, every push. Locally
 * `npx playwright install webkit` once, or `npm run test:e2e:android` to
 * skip it. The dev server uses whatever data/cardflip.db is present: a fresh
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
    trace: "retain-on-failure",
    // public/sw.js (the offline page) answers every fetch on the site, and on WebKit page.route never sees a
    // request a service worker made: the first iPhone run's scans reached the real /api/vision/scan, mocks and
    // the outside-host guard bypassed (10-31). No spec is about the offline page, so the worker stays off.
    serviceWorkers: "block",
    // Camera permission is deliberately NOT granted: the scanner's blocked-
    // permission state is one of the screens under test.
  },
  projects: [
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "iphone", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
