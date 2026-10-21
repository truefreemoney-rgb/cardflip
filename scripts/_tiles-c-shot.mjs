// Phone shot of the Inventory summary after the Unsold / Sold rename (Chris 10-21, option C), folded and opened. Local dev, admin.
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "docs/shots";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await c.addCookies([{ name: "cf_internal", value: "1", url: "http://localhost:3000" }]);
const r = await c.request.post("http://localhost:3000/api/auth/login", { data: { email: "admin", password: "password" } });
if (!r.ok()) throw new Error(`login ${r.status()}`);
const p = await c.newPage();
await p.goto("http://localhost:3000/app/collection", { waitUntil: "networkidle", timeout: 180_000 });
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/tiles-c-folded-phone.jpg`, clip: { x: 0, y: 300, width: 375, height: 160 } });
await p.getByText("Unsold", { exact: false }).first().click();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/tiles-c-open-phone.jpg` });
console.log("shots done");
await b.close();
