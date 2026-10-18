// Phone shot of a rendered Sunday mail HTML file (10-18). node scripts/_week-mail-shot.mjs <in.html> <out.png>
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
const [, , inFile, out] = process.argv;
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true })).newPage();
await p.goto(pathToFileURL(inFile).href);
await p.waitForTimeout(800);
await p.screenshot({ path: out, fullPage: true });
await b.close();
