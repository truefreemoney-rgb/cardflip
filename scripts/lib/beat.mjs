// Beat analysis for the social videos: tempo, beat phase and a good start
// point in a track, from the audio alone (no library). ffmpeg decodes to
// mono 11025 Hz PCM; an onset envelope (positive energy change per 23ms hop)
// is autocorrelated over 70-180 BPM; the phase is the grid offset where the
// onsets add up most. The start is the first beat after the track gets loud
// (skips a quiet intro) so a 15s clip lands in the meat of the song.
import { spawnSync } from "node:child_process";

const SR = 11025;
const HOP = 256; // 23.2 ms

export async function analyzeBeat(file, { clipSeconds = 16 } = {}) {
  const ffmpeg = (await import("ffmpeg-static")).default;
  const r = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${r.stderr?.toString().slice(-300)}`);
  const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 1);
  const frames = Math.floor(pcm.length / HOP);
  const energy = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let j = i * HOP; j < (i + 1) * HOP; j++) s += pcm[j] * pcm[j];
    energy[i] = Math.sqrt(s / HOP);
  }
  // Onset envelope: energy rises only, lightly smoothed.
  const onset = new Float64Array(frames);
  for (let i = 1; i < frames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  const hopSec = HOP / SR;

  // Tempo by autocorrelation of the onset envelope (whole track, capped at 90s).
  const N = Math.min(frames, Math.round(90 / hopSec));
  let best = { bpm: 120, score: -1 };
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) / hopSec;
    const l0 = Math.floor(lag), frac = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < N; i++) s += onset[i] * (onset[i + l0] * (1 - frac) + onset[i + l0 + 1] * frac);
    // Mild preference for the 100-140 range so half/double-time ties resolve to the danceable one.
    const w = bpm >= 100 && bpm <= 140 ? 1.06 : 1;
    if (s * w > best.score) best = { bpm, score: s * w };
  }
  const period = 60 / best.bpm;

  // Loudness per second; the clip starts once the track reaches 70% of its peak second.
  const perSec = [];
  const fps = Math.round(1 / hopSec);
  for (let s = 0; (s + 1) * fps <= frames; s++) {
    let a = 0;
    for (let i = s * fps; i < (s + 1) * fps; i++) a += energy[i];
    perSec.push(a / fps);
  }
  const peak = Math.max(...perSec);
  const total = perSec.length;
  let loudFrom = perSec.findIndex((v, s) => v >= 0.7 * peak && s + clipSeconds <= total);
  if (loudFrom < 0) loudFrom = 0;

  // Beat phase: the grid offset (within one period) whose points carry the most onset energy, measured over the clip window.
  const from = Math.round(loudFrom / hopSec), to = Math.min(frames, Math.round((loudFrom + clipSeconds + 4) / hopSec));
  let phase = 0, phaseScore = -1;
  const steps = 48;
  for (let k = 0; k < steps; k++) {
    const off = (k / steps) * period;
    let s = 0;
    for (let t = loudFrom + off; t < to * hopSec; t += period) {
      const i = Math.round(t / hopSec);
      if (i >= from && i < frames) s += onset[i] + 0.5 * (onset[i - 1] ?? 0) + 0.5 * (onset[i + 1] ?? 0);
    }
    if (s > phaseScore) { phaseScore = s; phase = off; }
  }
  // Downbeat (bar start) among the four beat positions: the one with the heaviest onsets, over the clip.
  let bar = 0, barScore = -1;
  for (let b = 0; b < 4; b++) {
    let s = 0;
    for (let t = loudFrom + phase + b * period; t < to * hopSec; t += 4 * period) {
      const i = Math.round(t / hopSec);
      if (i < frames) s += onset[i];
    }
    if (s > barScore) { barScore = s; bar = b; }
  }
  const start = loudFrom + phase + bar * period;
  return { bpm: best.bpm, period, start, duration: frames * hopSec };
}
