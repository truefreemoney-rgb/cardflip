// Which backing track a video gets (scripts/social-video.mjs). Pure, so the
// rotation is testable (scripts/test-social-tiktok.mjs).
//
// The three videos of a day are offset by slot: the 1pm movers video keeps the
// plain day rotation (dayIndex % tracks), so the file every site posts sounds
// as it always did; 7am is one track on, 7pm two. With fewer tracks than
// slots the videos that land on the same track do not repeat the opening:
// each further one starts SECTION_BARS bars deeper in (bar-aligned, so the
// cut still lands on the beat). Only tracks committed to git reach the
// GitHub runner, and that is ONE today, so this is what production does.
export const AUDIO_OFFSET = { midday: 0, morning: 1, evening: 2 };
const ORDER = ["midday", "morning", "evening"];
export const SECTION_BARS = 8;

/** Index into the sorted track list for a slot on a day. */
export function trackIndex(slot, dayIndex, trackCount) {
  return (dayIndex + AUDIO_OFFSET[slot]) % trackCount;
}

/** How many earlier videos of the same day share this slot's track (0 = it opens the track). */
export function sectionFor(slot, dayIndex, trackCount) {
  const mine = trackIndex(slot, dayIndex, trackCount);
  return ORDER.slice(0, ORDER.indexOf(slot)).filter((s) => trackIndex(s, dayIndex, trackCount) === mine).length;
}

/**
 * Where in the track the video starts: the beat analysis's own start, plus
 * `section` steps of SECTION_BARS bars, backed off one step at a time until
 * the whole video (and its fade) fits inside the track.
 */
export function audioStart({ start, duration }, oneBar, section, videoSeconds) {
  for (let k = section; k > 0; k--) {
    const s = start + k * SECTION_BARS * oneBar;
    if (s + videoSeconds + 0.7 <= duration) return s;
  }
  return start;
}
