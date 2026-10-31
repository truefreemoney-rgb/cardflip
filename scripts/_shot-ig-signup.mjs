// 10-31: /signup on a phone in Safari vs inside Instagram's browser (Google button hidden there). Local dev only.
import { webkit, devices } from "@playwright/test";
const IG = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 352.0.0.38.100 (iPhone15,3; iOS 18_0; en_US; en; scale=3.00; 1290x2796; 650120155)";
const browser = await webkit.launch();
for (const [name, ua] of [["safari", devices["iPhone 13"].userAgent], ["instagram", IG]]) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], userAgent: ua, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/signup", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const google = await page.getByRole("button", { name: "Continue with Google" }).count();
  console.log(name, "google buttons:", google);
  await page.screenshot({ path: `docs/shots/signup-${name}-phone.jpg`, type: "jpeg", quality: 80 });
  await ctx.close();
}
await browser.close();
