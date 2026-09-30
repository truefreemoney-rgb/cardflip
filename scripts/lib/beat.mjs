// Beat analysis for the social videos: tempo, beat phase, a good start point
// and the drumless stretches of a track, from the audio alone (no library).
// ffmpeg decodes to mono 22050 Hz PCM twice: the full band, and the 40-160 Hz
// band (the kick and the bass). Each becomes an onset envelope (positive
// energy change per 5.8ms hop, divided by its own 2s average so a loud
// section cannot outvote a quiet one; the two are summed).
//
// The tempo comes in two steps. A coarse pass autocorrelates a 23ms-hop
// envelope over 70-180 BPM in 0.5 BPM steps. That is not good enough to put
// a cut on the beat 20+ seconds into a track: the committed track is 113 BPM
// and 112.5 is 2.4ms wrong per beat, 76ms late after the 8 bars a later
// section starts at and over 100ms late by the end of a 26s video (09-30
// review). So a fine pass measures the grid phase in 8s windows across the
// loud body of the track and follows how that phase drifts from window to
// window (a tempo error shows up as a straight line), corrects the period by
// the slope and repeats. A breakdown can shift the whole groove by a few
// tens of ms without the tempo changing, so the body is cut into segments at
// the drumless stretches, each segment keeps its own phase, and only the
// slope is shared.
//
// The start is the first downbeat after the track gets loud (skips a quiet
// intro). phaseAt(t) says where the beat falls in the segment t is in, so
// scripts/lib/audio-plan.mjs can put a later section's start on ITS beat.
import { spawnSync } from "node:child_process";

const SR = 22050;
const HOP = 128; // 5.8 ms
// The coarse tempo pass is the original one: mono 11025 Hz, 23.2 ms hops. It picks the family (112.5 rather than
// 76, its 2:3 cousin) the way it always has; the 22050 Hz envelopes below only refine it.
const COARSE_SR = 11025;
const COARSE_HOP = 256;
/** A drumless stretch is at least this long (seconds) with the kick/bass band under a fifth of its usual level. */
const GAP_SECONDS = 1;
const GAP_LEVEL = 0.2;
/** Beat-phase windows: 8s long, every 4s. */
const WIN = 8;
const WIN_STEP = 4;

function decode(ffmpeg, file, filter, sr = SR) {
  const args = ["-v", "error", "-i", file, "-ac", "1", "-ar", String(sr)];
  if (filter) args.push("-af", filter);
  args.push("-f", "s16le", "-");
  const r = spawnSync(ffmpeg, args, { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${r.stderr?.toString().slice(-300)}`);
  return new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 1);
}

/** RMS per `hop` samples. */
function rmsFrames(pcm, hop) {
  const frames = Math.floor(pcm.length / hop);
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += pcm[j] * pcm[j];
    out[i] = Math.sqrt(s / hop);
  }
  return out;
}

/** Positive energy change, divided by its own average over +-2s. */
function normalisedOnsets(energy, hopSec) {
  const n = energy.length;
  const raw = new Float64Array(n);
  for (let i = 1; i < n; i++) raw[i] = Math.max(0, energy[i] - energy[i - 1]);
  const w = Math.round(2 / hopSec);
  const sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + raw[i];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w);
    out[i] = raw[i] / ((sum[b] - sum[a]) / (b - a) + 1e-9);
  }
  return out;
}

const wrap = (x, period) => x - Math.round(x / period) * period;

export async function analyzeBeat(file, { clipSeconds = 16 } = {}) {
  const ffmpeg = (await import("ffmpeg-static")).default;
  const pcm = decode(ffmpeg, file);
  const hopSec = HOP / SR;
  const fineFull = rmsFrames(pcm, HOP);
  const frames = fineFull.length;
  const duration = pcm.length / SR;

  // ---- coarse tempo: autocorrelation of a 23ms-hop onset envelope (whole track, capped at 90s) ----
  const coarseSec = COARSE_HOP / COARSE_SR;
  const energy = rmsFrames(decode(ffmpeg, file, null, COARSE_SR), COARSE_HOP);
  const cFrames = energy.length;
  const onset = new Float64Array(cFrames);
  for (let i = 1; i < cFrames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  const N = Math.min(cFrames, Math.round(90 / coarseSec));
  let best = { bpm: 120, score: -1 };
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) / coarseSec;
    const l0 = Math.floor(lag), frac = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < N; i++) s += onset[i] * (onset[i + l0] * (1 - frac) + onset[i + l0 + 1] * frac);
    // Mild preference for the 100-140 range so half/double-time ties resolve to the danceable one.
    const w = bpm >= 100 && bpm <= 140 ? 1.06 : 1;
    if (s * w > best.score) best = { bpm, score: s * w };
  }

  // Loudness per second; the clip starts once the track reaches 70% of its peak second.
  const perSec = [];
  for (let s = 0; s + 1 <= duration; s++) {
    let a = 0;
    const i0 = Math.round(s / coarseSec), i1 = Math.round((s + 1) / coarseSec);
    for (let i = i0; i < i1 && i < cFrames; i++) a += energy[i];
    perSec.push(a / (i1 - i0));
  }
  const peak = Math.max(...perSec);
  let loudFrom = perSec.findIndex((v, s) => v >= 0.7 * peak && s + clipSeconds <= perSec.length);
  if (loudFrom < 0) loudFrom = 0;

  // ---- the two onset envelopes, summed: everything (melody, hats) plus the kick and bass ----
  const low = rmsFrames(decode(ffmpeg, file, "highpass=f=40,lowpass=f=160"), HOP);
  const oFull = normalisedOnsets(fineFull, hopSec);
  const oLow = normalisedOnsets(low, hopSec);
  const o = new Float64Array(frames);
  for (let i = 0; i < frames; i++) o[i] = oFull[i] + oLow[i];

  // ---- drumless stretches: the kick/bass band far under its usual level for a second or more ----
  const win = Math.round(0.1 / hopSec);
  const lows = [];
  for (let i = 0; i + win <= frames; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += low[j] * low[j];
    lows.push(Math.sqrt(s / win));
  }
  const level = [...lows].sort((x, y) => x - y)[Math.floor(lows.length * 0.9)] || 1;
  const gaps = [];
  let run = -1;
  for (let k = 0; k <= lows.length; k++) {
    const quiet = k < lows.length && lows[k] < GAP_LEVEL * level;
    if (quiet && run < 0) run = k;
    if (!quiet && run >= 0) {
      if ((k - run) * 0.1 >= GAP_SECONDS - 1e-9) gaps.push({ from: Math.round(run) / 10, to: Math.round(k) / 10 });
      run = -1;
    }
  }

  /** Where the onsets in [a, b] say the beats fall (seconds, within one period of 0), and how sharply they agree (0..1). */
  function phaseIn(a, b, period) {
    let re = 0, im = 0, tot = 0;
    const i1 = Math.min(frames, Math.round(b / hopSec));
    for (let i = Math.max(0, Math.round(a / hopSec)); i < i1; i++) {
      const ang = (2 * Math.PI * i * hopSec) / period;
      re += o[i] * Math.cos(ang);
      im += o[i] * Math.sin(ang);
      tot += o[i];
    }
    return { phase: (Math.atan2(im, re) / (2 * Math.PI)) * period, mag: Math.hypot(re, im), strength: tot > 0 ? Math.hypot(re, im) / tot : 0 };
  }

  // ---- fine tempo and per-segment phase ----
  const bodyEnd = Math.max(loudFrom + clipSeconds, duration - 1);
  // The groove is cut at the middle of each drumless stretch inside the body: segment k is what lies between cut k-1 and cut k.
  const cuts = gaps.filter((g) => g.to > loudFrom + 2 && g.from < bodyEnd - 2).map((g) => (g.from + g.to) / 2);
  const segmentOf = (t) => cuts.filter((c) => c < t).length;
  const overlapsGap = (a, b) => gaps.some((g) => Math.min(b, g.to) - Math.max(a, g.from) >= 0.5);
  /** The windows of the loud body that carry a clear beat, each with its segment and its phase unwrapped against its neighbours. */
  function bodyWindows(p) {
    const pts = [];
    for (let a = loudFrom - 1.5; a + WIN <= bodyEnd + 1e-9; a += WIN_STEP) {
      // A window across a breakdown has half of two grooves in it: no use to either.
      if (overlapsGap(a, a + WIN)) continue;
      pts.push({ tc: a + WIN / 2, seg: segmentOf(a + WIN / 2), ...phaseIn(a, a + WIN, p) });
    }
    if (pts.length === 0) return [];
    const med = pts.map((q) => q.strength).sort((x, y) => x - y)[Math.floor(pts.length / 2)];
    const good = pts.filter((q) => q.strength >= 0.6 * med);
    // Neighbouring windows differ by far less than half a period, so unwrapping is safe.
    let prev = good[0].phase;
    const out = [{ ...good[0], ph: prev }];
    for (let k = 1; k < good.length; k++) {
      prev += wrap(good[k].phase - prev, p);
      out.push({ ...good[k], ph: prev });
    }
    return out;
  }
  /** The shared drift per second of the phase (each segment has its own starting point). */
  function slopeOf(un) {
    const bySeg = new Map();
    for (const q of un) bySeg.set(q.seg, [...(bySeg.get(q.seg) ?? []), q]);
    let num = 0, den = 0;
    for (const list of bySeg.values()) {
      if (list.length < 2) continue;
      const sw = list.reduce((s, q) => s + q.mag, 0);
      const mx = list.reduce((s, q) => s + q.mag * q.tc, 0) / sw;
      const my = list.reduce((s, q) => s + q.mag * q.ph, 0) / sw;
      for (const q of list) { num += q.mag * (q.tc - mx) * (q.ph - my); den += q.mag * (q.tc - mx) ** 2; }
    }
    return den > 1e-9 ? num / den : 0;
  }
  let period = 60 / best.bpm;
  for (let iter = 0; iter < 5; iter++) {
    const slope = slopeOf(bodyWindows(period));
    // The phase of a beat that comes `slope` seconds later every second is a straight line in time; a period
    // that is right makes it flat. 1ms of slope per second is 0.1 BPM, and a real correction stays within 0.6 of the coarse pass.
    const next = period / (1 - slope);
    if (Math.abs(60 / next - best.bpm) > 0.6) break;
    period = next;
    if (Math.abs(slope) < 2e-5) break;
  }
  // Each segment's beat: the strength-weighted middle of its windows at the settled period.
  const finalWindows = bodyWindows(period);
  const phases = [];
  for (let k = 0; k <= cuts.length; k++) {
    const list = finalWindows.filter((q) => q.seg === k);
    const sw = list.reduce((s, q) => s + q.mag, 0);
    phases.push(sw > 0 ? list.reduce((s, q) => s + q.mag * q.ph, 0) / sw : null);
  }
  // A segment with no clear window borrows its neighbour's beat (a fallback; the committed track has none).
  const firstKnown = phases.find((p) => p !== null) ?? phaseIn(loudFrom, bodyEnd, period).phase;
  for (let k = 0; k < phases.length; k++) if (phases[k] === null) phases[k] = k > 0 ? phases[k - 1] : firstKnown;
  const bpm = Math.round((60 / period) * 100) / 100;
  /** Seconds, within one period: where the beats fall at time t (the segment t is in has its own). */
  const phaseAt = (t) => ((phases[Math.min(phases.length - 1, segmentOf(t))] % period) + period) % period;

  // ---- start: the first downbeat (heaviest of the four beat positions over the opening clip) at or after the loud point ----
  const phase0 = phaseAt(loudFrom);
  const first = loudFrom + ((((phase0 - loudFrom) % period) + period) % period);
  const clipEnd = Math.min(bodyEnd, loudFrom + clipSeconds + 4);
  let bar = 0, barScore = -1;
  for (let b = 0; b < 4; b++) {
    let s = 0;
    for (let t = first + b * period; t < clipEnd; t += 4 * period) {
      const i = Math.round(t / hopSec);
      if (i < frames) s += o[i] + 0.5 * (o[i - 1] ?? 0) + 0.5 * (o[i + 1] ?? 0);
    }
    if (s > barScore) { barScore = s; bar = b; }
  }
  const start = first + bar * period;

  return {
    bpm,
    period,
    start,
    duration,
    gaps,
    phaseAt,
    /**
     * Re-measure the beat on the stretch a video will actually play, [from, to] (without any breakdown it
     * spills into): { offset, strength }. `offset` is how many seconds to move a start that sits on the
     * first segment's grid so it lands on that stretch's beat, + = later; `strength` is how sharply the
     * onsets there agree (0..1).
     */
    fitWindow(from, to) {
      const mid = (from + to) / 2;
      const lo = Math.max(from, ...gaps.filter((g) => g.to <= mid).map((g) => g.to));
      const hi = Math.min(to, ...gaps.filter((g) => g.from >= mid).map((g) => g.from));
      const clean = hi - lo >= 4;
      const w = phaseIn(clean ? lo : from, clean ? hi : to, period);
      return { offset: wrap(w.phase - phase0, period), strength: w.strength };
    },
  };
}
