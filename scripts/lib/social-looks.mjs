// The social video's LOOKS (docs/SOCIAL-ANGLES-PLAN.md phase 4; Chris 10-03:
// "bored of the same template"). Three looks for the one scene: `classic`
// (the scene as it has always been: no CSS appended, byte-identical), `ember`
// (warm: a deep maroon field, amber labels and a gold title) and `arctic`
// (cold: a navy field, ice-blue labels, a white-to-cyan title). The price
// stays the green pop in every look (Chris's standing note), the layout
// never moves (the TikTok safe box is the same), only colour, the art frame
// and the label letter-spacing change. Each day hands its three videos the
// three looks in a shuffled order (dayShuffle on another salt), so no two
// videos of a day look alike and the order changes daily. Pure, tested in
// scripts/test-social-tiktok.mjs.
import { dayShuffle } from "./audio-plan.mjs";

export const LOOKS = ["classic", "ember", "arctic"];
/** Another seed than the audio's, so the look and the track do not rotate in step. */
const LOOK_SALT = 0x5a17;
const ORDER = ["midday", "morning", "evening"];

/** The look a slot's video wears on a day. A forced look (--look) is taken when it is one of LOOKS. */
export function lookFor(dayIndex, slot, forced = "") {
  if (forced && LOOKS.includes(forced)) return forced;
  return LOOKS[dayShuffle(dayIndex ^ LOOK_SALT, LOOKS.length)[Math.max(0, ORDER.indexOf(slot)) % LOOKS.length]];
}

/** The CSS appended to the scene for a look; "" for classic, so that scene is byte-identical to the one before looks existed. */
export function lookCss(look) {
  if (look === "ember") {
    return `
  /* look: ember */
  html, body { background:#140909; }
  body { background: radial-gradient(60% 45% at 50% 0%, rgba(249,115,22,.34), transparent 70%),
                     radial-gradient(45% 40% at 100% 100%, rgba(251,191,36,.16), transparent 70%), #140909; }
  .holo-text, #intro .title, #outro .url { background:linear-gradient(90deg,#fde68a,#fbbf24,#fb923c,#f87171); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .holo { background:linear-gradient(90deg,#fde68a,#fbbf24,#fb923c,#f87171); }
  .kicker, #intro .kicker, .rank, .beat .rank, #outro .now, .thennow .row .lbl { color:#fbbf24; letter-spacing:.22em; }
  .art, .beat .art, #intro .hook .hart { border-radius:18px; box-shadow:0 40px 120px rgba(0,0,0,.65), 0 0 0 3px rgba(251,191,36,.35); background:#241212; }
  .versus .vs { background:#140909; box-shadow:0 0 0 3px #fbbf24, 0 12px 40px rgba(0,0,0,.7); }
  .versus .wintag { color:#140909; background:#fbbf24; }
  #footer .dot { background:#f97316; }
`;
  }
  if (look === "arctic") {
    return `
  /* look: arctic */
  html, body { background:#06101c; }
  body { background: radial-gradient(60% 45% at 50% 0%, rgba(14,165,233,.34), transparent 70%),
                     radial-gradient(45% 40% at 0% 100%, rgba(167,243,208,.14), transparent 70%), #06101c; }
  .holo-text, #intro .title, #outro .url { background:linear-gradient(90deg,#ffffff,#bae6fd,#67e8f9,#a5f3fc); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .holo { background:linear-gradient(90deg,#ffffff,#bae6fd,#67e8f9,#a5f3fc); }
  .kicker, #intro .kicker, .rank, .beat .rank, #outro .now, .thennow .row .lbl { color:#67e8f9; letter-spacing:.26em; }
  .art, .beat .art, #intro .hook .hart { border-radius:48px; box-shadow:0 30px 100px rgba(0,0,0,.6), 0 0 0 2px rgba(103,232,249,.3), 0 0 60px rgba(14,165,233,.25); background:#0c1a2b; }
  .versus .vs { background:#06101c; box-shadow:0 0 0 3px #67e8f9, 0 12px 40px rgba(0,0,0,.7); }
  .versus .wintag { color:#06101c; background:#67e8f9; }
  #footer .dot { background:#0ea5e9; }
`;
  }
  return "";
}
