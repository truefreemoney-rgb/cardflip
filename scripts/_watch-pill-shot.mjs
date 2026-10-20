// Scratch: phone shot of the card page sticky bar (compact Watch pill, 10-20), signed in and signed out.
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "docs/shots";
const b = await chromium.launch();
for (const [tag, login] of [["signed-in", true], ["signed-out", false]]) {
  const c = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (login) { const r = await c.request.post("http://localhost:3000/api/auth/login", { data: { email: "admin", password: "password" } }); if (!r.ok()) throw new Error("login"); }
  const p = await c.newPage();
  await p.goto("http://localhost:3000/cards/pokemon/base-set/charizard--base1-4", { waitUntil: "networkidle", timeout: 180000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/watch-pill-${tag}-phone.jpg`, type: "jpeg", quality: 80 });
  const btn = p.getByRole("button", { name: "Watch this price" }).last();
  console.log(tag, "pill box:", JSON.stringify(await btn.boundingBox()));
  await c.close();
}
await b.close();
