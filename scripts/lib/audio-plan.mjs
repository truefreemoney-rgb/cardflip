// Which backing track a video gets, and where in it (scripts/social-video.mjs).
// Pure, so the rotation and the timeline are testable (scripts/test-social-tiktok.mjs).
//
// Chris 09-30: "randomize the audio to audio we used in previous posts". The
// folder holds the tracks that have aired; each day shuffles them (seeded by
// the day, so a re-render the same day picks the same) and hands them out
// 1pm, 7am, 7pm, so with three tracks the day's three videos never share
// one. With fewer tracks than slots the videos that land on the same track
// do not repeat the opening: each further one starts SECTION_BARS bars
// deeper in (a whole number of bars, so the cut still lands on the beat).
// Two things keep that honest (09-30 review):
//  - the start is then moved onto the beat of the stretch it lands in
//    (scripts/lib/beat.mjs phaseAt): a breakdown can shift the groove by
//    tens of ms, and a grid measured in the opening is that much off after it;
//  - the intro and the cards must never sit on a drumless stretch (a
//    breakdown: the price pop would land with no kick under it, or the video
//    would open on silence), so a section that would is moved to the nearest
//    bar that clears it, and never onto a bar another video of the day has.
const ORDER = ["midday", "morning", "evening"];
export const SECTION_BARS = 8;
/** The fade-out after the last frame. */
const FADE_TAIL = 0.7;
/** The most a start is moved onto the local beat (seconds); a bigger offset is a bad measurement, not a groove. */
export const NUDGE_MAX = 0.15;
/** Under this a stretch has no clear beat to move onto (0..1, see beat.mjs). */
export const NUDGE_MIN_STRENGTH = 0.03;

/** The day's shuffle of track indices 0..trackCount-1 (Fisher-Yates on a mulberry32 stream seeded by the day). */
export function dayShuffle(dayIndex, trackCount) {
  let a = (Math.imul(dayIndex ^ 0x9e3779b9, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: trackCount }, (_, i) => i);
  for (let i = trackCount - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Index into the sorted track list for a slot on a day. */
export function trackIndex(slot, dayIndex, trackCount) {
  return dayShuffle(dayIndex, trackCount)[ORDER.indexOf(slot) % trackCount];
}

/** How many earlier videos of the same day share this slot's track (0 = it opens the track). */
export function sectionFor(slot, dayIndex, trackCount) {
  const mine = trackIndex(slot, dayIndex, trackCount);
  return ORDER.slice(0, ORDER.indexOf(slot)).filter((s) => trackIndex(s, dayIndex, trackCount) === mine).length;
}

/** True when the intro or a card of a video that starts at `s` would play over a drumless stretch (the outro may: it is a logo). */
export function bodyHitsGap(s, gaps, { intro, beat, cards }) {
  const end = s + intro + beat * cards;
  return gaps.some((g) => g.from < end && g.to > s);
}

/**
 * Where in the track the video starts, on the beat analysis's grid: `section`
 * steps of SECTION_BARS bars after its own start. When that spot does not
 * hold the whole video (and its fade), or the intro or a card would play over
 * a drumless stretch (`gaps`, with `layout` = { intro, beat, cards } saying
 * where they fall), or another video of the day starts within a bar of it
 * (`taken`), the nearest bar that does; the deeper one on a tie.
 */
export function audioStart({ start, duration, gaps = [] }, oneBar, section, videoSeconds, layout = null, taken = []) {
  const want = start + section * SECTION_BARS * oneBar;
  const fits = [];
  for (let j = 0; start + j * oneBar + videoSeconds + FADE_TAIL <= duration; j++) fits.push(start + j * oneBar);
  fits.sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || b - a);
  const distinct = (s) => !taken.some((t) => Math.abs(t - s) < oneBar - 1e-6);
  for (const s of fits) {
    if (layout && gaps.length && bodyHitsGap(s, gaps, layout)) continue;
    if (distinct(s)) return s;
  }
  // Nothing clears the gaps (a track that is mostly breakdown): keep the videos apart at least.
  return fits.find(distinct) ?? start;
}

/** `start` moved onto the beat of the stretch the video plays (beat.mjs fitWindow: { offset, strength }), within NUDGE_MAX. */
export function nudgeStart(start, fit) {
  if (!fit || !(fit.strength >= NUDGE_MIN_STRENGTH) || !Number.isFinite(fit.offset)) return start;
  return start + Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, fit.offset));
}

/**
 * The whole timeline of one video with a track: the tempo-derived intro, card
 * and outro lengths, and the second of the track it starts at.
 *   b = analyzeBeat's result; section = sectionFor(); cards = how many; mixed = the
 *   mixed-movers outro (names five games one per beat, two bars).
 * Two bars per card (Chris 09-26: "flipping through the cards so fast, the
 * user barely has time to read anything, make it slower"): ~4.2s a card at
 * 113 bpm, ~26s for five. Intro and outro stay one bar.
 */
export function timelineFor(b, { section, cards, mixed = false }) {
  // The earlier sections' starts, so this one does not land on the same bar of the track.
  const taken = [];
  for (let k = 0; k < section; k++) taken.push(timelineFor(b, { section: k, cards, mixed }).rawStart);
  const bar = 4 * b.period;
  const oneBar = bar < 1.5 ? 2 * bar : bar > 2.9 ? bar / 2 : bar;
  const BEAT = 2 * oneBar;
  const INTRO = oneBar;
  const OUTRO = (mixed ? 2 : 1) * oneBar + 0.6;
  const total = INTRO + BEAT * cards + OUTRO;
  const rawStart = audioStart(b, oneBar, section, total, { intro: INTRO, beat: BEAT, cards }, taken);
  const start = nudgeStart(rawStart, b.fitWindow?.(rawStart, rawStart + total));
  return { PERIOD: b.period, oneBar, INTRO, BEAT, OUTRO, total, rawStart, start };
}
