// Words for the square X ads, drawn flat and sharp on top of the Blender frames (10-26 v3). 3D text showed its extruded
// sides off-centre and read melted (Chris: "the white text is almost unreadable", "text is messed up"), so the scenes
// now render no words and this adds them: Segoe UI Black / Bold through librsvg, a dark outline + soft shadow, sizes
// that still read on a phone in the feed, nothing in the bottom corners (X's timer + mute icon).
// node overlay.mjs <scene> "<scene frames dir>"   reads <dir>/raw/{f,still}_NNNN.png + raw/overlay.json, writes <dir>/
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [scene, dir] = process.argv.slice(2);
const raw = path.join(dir, "raw");
const meta = JSON.parse(fs.readFileSync(path.join(raw, "overlay.json"), "utf8"));
const W = meta.w, H = meta.h;

// ---- motion: the same curves as cf_lib.pop / count_up ----
const clamp = (t) => Math.max(0, Math.min(1, t));
const ease = (t) => t * t * (3 - 2 * t);
const pop = (f, f0, big = 1.18) => f < f0 - 1 ? 0 : f <= f0 + 5 ? big * ease((f - f0 + 1) / 6) : f <= f0 + 10 ? big + (1 - big) * ease((f - f0 - 5) / 5) : 1;
const gone = (f, f1, dur = 6) => 1 - ease(clamp((f - f1) / dur));   // 1 until f1, then down to 0
const bump = (f, f0, amp = 0.07) => f < f0 || f > f0 + 6 ? 1 : f <= f0 + 2 ? 1 + amp * ease((f - f0) / 2) : 1 + amp * (1 - ease((f - f0 - 2) / 4));
const count = (f, f0, dur, v) => v * (1 - (1 - clamp((f - f0) / dur)) ** 3);
const money = (v) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- drawing ----
const HEAVY = "Segoe UI Black", BOLD = "Segoe UI";
const C = { white: "#ffffff", green: "#3dff8f", gold: "#ffc94a", lilac: "#dccbff", ink: "#0a0614", plate: "#130e24", grey: "#c9c6d6" };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const DEFS = `<defs><filter id="sh" x="-20%" y="-40%" width="140%" height="190%"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/>
<feOffset dy="4"/><feComponentTransfer><feFuncA type="linear" slope="0.65"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
const at = (x, y, scale, body, opacity = 1) => scale <= 0.002 ? "" :
  `<g transform="translate(${x} ${y}) scale(${scale.toFixed(4)}) translate(${-x} ${-y})" opacity="${opacity}">${body}</g>`;

/** y = vertical centre of the capitals (like Blender's align_y CENTER); anchor start|middle|end; ox = the x it pops
 *  from (left-anchored words pass their middle, or the pop's overshoot runs them off the frame). */
function text(s, x, y, size, { fill = C.white, font = HEAVY, weight = 900, anchor = "middle", stroke = C.ink, sw = Math.max(4, size * 0.13), scale = 1, shadow = true, ox = x, alpha = 1, parts = null } = {}) {
  // parts = [[words, colour], ...] for one line in several colours
  const body = parts ? parts.map(([w, c]) => `<tspan fill="${c}">${esc(w)}</tspan>`).join("") : esc(s);
  const t = `<text x="${x}" y="${(y + size * 0.355).toFixed(1)}" text-anchor="${anchor}" font-family="${font}" font-weight="${weight}" font-size="${size}" fill="${fill}"` +
    (stroke ? ` stroke="${stroke}" stroke-width="${sw.toFixed(1)}" stroke-linejoin="round" paint-order="stroke"` : "") + ` xml:space="preserve">${body}</text>`;
  return at(ox, y, scale, shadow ? `<g filter="url(#sh)">${t}</g>` : t, alpha);
}
function pill(x, y, w, h, { fill = C.plate, rim = C.lilac, rw = 4, scale = 1, opacity = 0.95, alpha = 1 } = {}) {
  const r = h * 0.38;
  return at(x, y, scale, `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${r}" fill="${fill}" fill-opacity="${opacity}" stroke="${rim}" stroke-width="${rw}" filter="url(#sh)"/>`, alpha);
}
/** squash vertically (a flip card turning over): sy 1 -> 0 -> 1 around the chip's middle */
const squash = (x, y, sy, body) => sy <= 0.002 ? "" : `<g transform="translate(${x} ${y}) scale(1 ${sy.toFixed(4)}) translate(${-x} ${-y})">${body}</g>`;

// text widths, measured once by rendering the string (pills hug their words, long lines shrink to fit)
const widths = new Map();
async function measure(s, size, font = HEAVY, weight = 900) {
  const k = `${s}|${size}|${font}|${weight}`;
  if (!widths.has(k)) {
    const svg = `<svg width="${Math.ceil(size * s.length + 80)}" height="${Math.ceil(size * 1.8)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#000"/><text x="40" y="${size * 1.2}" font-family="${font}" font-weight="${weight}" font-size="${size}" fill="#fff">${esc(s)}</text></svg>`;
    const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
    widths.set(k, info.width);
  }
  return widths.get(k);
}
const fit = async (s, size, maxW, font, weight) => Math.min(size, Math.floor(size * maxW / await measure(s, size, font, weight)));

// ---- one layout per ad: async setup (measuring) returns draw(frame) -> svg body ----
const LAYOUTS = {
  async "A-pull"() {
    const { price, name, set, sub, chart } = meta;
    const X = 594, COL = 1150 - X;
    // left-aligned column right of the card; each line sized to fit and popping from its own middle
    const line = async (s, size, font = HEAVY, weight = 900) => {
      const sz = await fit(s, size, COL, font, weight);
      return { s, sz, font, weight, ox: X + (await measure(s, sz, font, weight)) / 2 };
    };
    const L1 = await line(name.toUpperCase(), 92), L2 = await line(set, 42, BOLD, 700), L3 = await line(money(price), 140);
    const L4 = await line(sub, 34, BOLD, 700), L5 = await line(chart, 34, BOLD, 700), L6 = await line("Scan yours at", 50, BOLD, 700);
    const L7 = await line("cardflip.io", 104);
    const hookS = await fit("PULLED SOMETHING GOOD?", 84, 1100);
    const put = (l, y, f0, fill, body = l.s) => text(body, X, y, l.sz, { fill, font: l.font, weight: l.weight, anchor: "start", ox: l.ox, scale: pop(f0[0], f0[1]) });
    return (f) =>
      text("PULLED SOMETHING GOOD?", 600, 132, hookS, { scale: f < 44 ? 1 : gone(f, 44, 6) }) +
      put(L1, 236, [f, 124], C.gold) + put(L2, 306, [f, 128], C.white) +
      put(L3, 412, [f, 132], C.green, money(count(f, 132, 28, price))) + put(L4, 500, [f, 140], C.grey) +
      put(L5, 770, [f, 182], C.grey) + put(L6, 880, [f, 192], C.white) + put(L7, 962, [f, 196], C.lilac);
  },

  async "B-binder"() {
    const { open1, t0, f0, hero, prices, land } = meta;
    const ids = Object.keys(land).map(Number);
    const events = ids.map((i) => [land[i], prices[i]]).sort((a, b) => a[0] - b[0]);
    const total = (f) => events.reduce((v, [fl, pr]) => v + (f >= fl + 8 ? pr : f > fl ? pr * (1 - (1 - (f - fl) / 8) ** 3) : 0), 0);
    const chipW = {};
    for (const i of ids) chipW[i] = (await measure(money(prices[i]), i === hero ? 66 : 46)) + (i === hero ? 56 : 36);
    const q = "What's YOUR binder worth?", qS = await fit(q, 66, 840);
    return (f) => {
      const a = (k) => meta.anchors[k][f - 1];
      let s = "";
      const hk = f < open1 - 2 ? 1 : gone(f, open1 - 2, 5);   // on screen from frame 1 (the thumbnail)
      s += text("OLD BINDER", 600, 96, 104, { scale: hk }) + text("IN THE CLOSET?", 600, 206, 104, { fill: C.gold, scale: hk });
      for (const i of ids) {    // a price chip pops on each card as it is scanned, the others clear when the hero lifts
        const hero_ = i === hero, [x, y] = a(hero_ ? "tagH" : `tag${i}`);
        const sc = hero_ ? pop(f, land[i], 1.2) : pop(f, land[i], 1.25) * gone(f, f0 + 6, 8);
        const h = hero_ ? 98 : 68;
        s += pill(x, y, chipW[i], h, { rim: C.green, rw: hero_ ? 5 : 4, scale: sc }) +
          text(money(prices[i]), x, y, hero_ ? 66 : 46, { fill: C.green, scale: sc, stroke: null, shadow: false });
      }
      const ps = pop(f, t0 - 2, 1.08) * events.reduce((m, [fl]) => m * bump(f, fl), 1);
      s += pill(600, 104, 500, 168, { scale: ps }) + text("PAGE TOTAL", 600, 52, 36, { font: BOLD, weight: 700, fill: C.lilac, scale: ps, stroke: null, shadow: false }) +
        text(money(total(f)), 600, 124, 100, { fill: C.green, scale: ps, stroke: null, shadow: false });
      s += pill(600, 1046, 900, 190, { scale: pop(f, f0 + 58, 1.06) }) +
        text(q, 600, 998, qS, { scale: pop(f, f0 + 60), stroke: null }) +
        text("cardflip.io", 600, 1086, 88, { fill: C.lilac, scale: pop(f, f0 + 66), stroke: null });
      return s;
    };
  },
};

const RED = "#ff4d6d";
/** a game-show answer button: dark fill, coloured rim, an arrow and the word */
function button(x, y, w, h, label, col, up, { scale = 1, alpha = 1, fill = "#120b1c" } = {}) {
  const ax = x - w / 2 + h * 0.62, s = h * 0.2;
  const tri = up ? `${ax - s},${y + s * 0.75} ${ax + s},${y + s * 0.75} ${ax},${y - s * 0.95}` : `${ax - s},${y - s * 0.75} ${ax + s},${y - s * 0.75} ${ax},${y + s * 0.95}`;
  return at(x, y, scale, `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h * 0.4}" fill="${fill}" fill-opacity="0.95" stroke="${col}" stroke-width="5" filter="url(#sh)"/>
    <polygon points="${tri}" fill="${col}"/>` + text(label, x + h * 0.28, y, h * 0.46, { fill: col, stroke: null, shadow: false }), alpha);
}

LAYOUTS["C-higher"] = async () => {
  const { prices: [lp, rp], phone_in, flip, phone_out, reveal, cta } = meta;
  const titleS = await fit("HIGHER OR LOWER?", 112, 1120), q = "Stop guessing. Scan it.", qS = await fit(q, 66, 820);
  const wL = (await measure(money(lp), 52)) + 44, wQ = (await measure("$??.??", 52)) + 44, wR = (await measure(money(rp), 52)) + 44;
  const back = phone_out + 8;    // the hidden chip comes back once the phone has dropped away
  return (f) => {
    const a = (k) => meta.anchors[k][f - 1];
    let s = "";
    // title until the reveal, then HIGHER!
    s += text("", 600, 112, titleS, { parts: [["HIGHER", C.green], [" OR ", C.white], ["LOWER?", RED]], scale: f < reveal ? 1 : gone(f, reveal, 4) });
    s += text("HIGHER!", 600, 116, 156, { fill: C.green, scale: pop(f, reveal + 3, 1.3) });
    // left price, shown from frame 1
    const [lx, ly] = a("chipL");
    s += pill(lx, ly, wL, 78, { rim: C.green }) + text(money(lp), lx, ly, 52, { fill: C.green, stroke: null, shadow: false });
    // right price: hidden ($??.??, breathing) -> off while the phone is in front -> back -> flips to the real price
    const [rx, ry] = a("chipR");
    if (f < reveal) {
      const sc = f < phone_in + 4 ? 1 + 0.05 * Math.sin(f / 4) : f < back ? gone(f, phone_in + 4, 4) : pop(f, back, 1.1);
      const sy = f < reveal - 4 ? 1 : 1 - ease((f - reveal + 4) / 4);
      s += squash(rx, ry, sy, pill(rx, ry, wQ, 78, { rim: C.lilac, scale: sc }) + text("$??.??", rx, ry, 52, { stroke: null, shadow: false, scale: sc }));
    } else {
      const sy = ease(clamp((f - reveal) / 4)), sc = f < reveal + 4 ? 1 : bump(f, reveal + 4, 0.16);
      s += squash(rx, ry, sy, pill(rx, ry, wR, 78, { rim: C.green, rw: 5, scale: sc }) + text(money(rp), rx, ry, 52, { fill: C.green, stroke: null, shadow: false, scale: sc }));
    }
    // HIGHER / LOWER buttons flash in turn while the viewer guesses; the answer lights up, then they make way for the CTA
    const out_ = gone(f, cta - 8, 6);
    if (out_ > 0.002) {
      let hi, lo;
      if (f < 24) {   // both lit at first: the thumbnail must not hint the answer
        hi = { scale: 1, alpha: 1 }; lo = { scale: 1, alpha: 1 };
      } else if (f >= flip && f < reveal + 2) {   // the phone has the answer: the buttons hold still until the stage says it
        hi = { scale: 1, alpha: 0.7 }; lo = { scale: 1, alpha: 0.7 };
      } else if (f < reveal + 2) {
        const t = Math.floor(f / 9) % 2 === 0;
        hi = { scale: t ? 1.05 : 1, alpha: t ? 1 : 0.5 }; lo = { scale: t ? 1 : 1.05, alpha: t ? 0.5 : 1 };
      } else {
        hi = { scale: pop(f, reveal + 2, 1.25) * 1.08, alpha: 1 }; lo = { scale: 0.92, alpha: 0.28 };
      }
      s += button(385, 1012, 390, 108, "HIGHER", C.green, true, { scale: hi.scale * out_, alpha: hi.alpha });
      s += button(815, 1012, 390, 108, "LOWER", RED, false, { scale: lo.scale * out_, alpha: lo.alpha });
    }
    s += pill(600, 1030, 900, 190, { scale: pop(f, cta, 1.06) }) +
      text(q, 600, 982, qS, { scale: pop(f, cta + 2), stroke: null }) +
      text("cardflip.io", 600, 1072, 88, { fill: C.lilac, scale: pop(f, cta + 8), stroke: null });
    return s;
  };
};

if (!LAYOUTS[scene]) throw new Error(`no overlay layout for ${scene}`);
const draw = await LAYOUTS[scene]();
const files = fs.readdirSync(raw).filter((f) => /^(f|still)_\d{4}\.png$/.test(f)).sort();
let next = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++], n = Number(file.match(/\d{4}/)[0]);
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${DEFS}${draw(n)}</svg>`;
    await sharp(path.join(raw, file)).sharpen({ sigma: 0.6 }).composite([{ input: Buffer.from(svg) }]).png({ compressionLevel: 4 }).toFile(path.join(dir, file));
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`overlay ${scene}: ${files.length} frames -> ${dir}`);
