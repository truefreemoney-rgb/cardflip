// A fake camera feed for the App Store scanner shot (Playwright --use-file-for-fake-video-capture):
// a card on a dark table, the card at 60% of the frame width like the scanner guide. Writes PNG + Y4M.
import sharp from "sharp";
import { execFileSync } from "node:child_process";
const [out, pic] = process.argv.slice(2);
const W = 1080, H = 1920;
const card = await sharp(Buffer.from(await (await fetch(pic)).arrayBuffer())).resize({ width: 600 }).flop().png().toBuffer();
const cm = await sharp(card).metadata();
// Table: dark warm grey with a soft spotlight and film grain.
const bgSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
<defs><radialGradient id="g" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="#3a3a40"/><stop offset="1" stop-color="#121216"/></radialGradient>
<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.08"/></feComponentTransfer></filter></defs>
<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
const shadow = await sharp({ create: { width: cm.width + 80, height: cm.height + 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: Buffer.from(`<svg width="${cm.width + 80}" height="${cm.height + 80}"><rect x="40" y="52" width="${cm.width}" height="${cm.height}" rx="28" fill="rgba(0,0,0,0.55)"/></svg>`) }])
  .blur(18).png().toBuffer();
const rounded = await sharp(card).composite([{ input: Buffer.from(`<svg width="${cm.width}" height="${cm.height}"><rect width="100%" height="100%" rx="26" fill="#fff"/></svg>`), blend: "dest-in" }]).rotate(2.5, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const rm = await sharp(rounded).metadata();
const left = Math.round((W - rm.width) / 2), top = Math.round((H - rm.height) / 2) - 20;
await sharp(Buffer.from(bgSvg)).composite([
  { input: await sharp(shadow).rotate(2.5, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer(), left: left - 40, top: top - 28 },
  { input: rounded, left, top },
]).png().toFile(`${out}/camera-frame.png`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", `${out}/camera-frame.png`, "-t", "2", "-r", "10", "-pix_fmt", "yuv420p", `${out}/camera-frame.y4m`]);
console.log("ok", `${out}/camera-frame.y4m`);
