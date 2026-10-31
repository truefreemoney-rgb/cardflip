"use client";

import { readSoundOn } from "@/lib/client/scanPrefs";

/**
 * The feel of a scan: a tick on capture, a rising arpeggio on a match (longer
 * for a big one, a run with a sparkle for a grail), a low buzz on a miss, each
 * with a haptic pattern on phones that support navigator.vibrate (Android; iOS
 * Safari ignores it). The old sounds were removed 10-02 ("we dont need audio
 * for the scanner"); these came back 10-30 (#17) as Chris's style B "Arcade",
 * on by default, with a "Reveal sounds" switch in Scanner options. Synthesised
 * with Web Audio: no files to load, nothing to wait for.
 */

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS) — silent no-op.
  }
}

let ctx: AudioContext | null = null;

/**
 * Create or wake the audio context. iOS only lets a page start audio inside a
 * tap, and the reveal plays seconds later, so the Capture button calls this
 * first thing in its click.
 */
export function fxUnlock(): void {
  if (!readSoundOn()) return;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** One voice: attack 5 ms, then an exponential fall with time constant `decay` (s). */
function voice(out: AudioNode, type: OscillatorType, freq: number, start: number, decay: number, gain: number, glideTo?: number, glideFor?: number) {
  const c = out.context;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo != null && glideFor) osc.frequency.linearRampToValueAtTime(glideTo, start + glideFor);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.005);
  amp.gain.setTargetAtTime(0, start + 0.005, decay);
  osc.connect(amp).connect(out);
  osc.start(start);
  osc.stop(start + 0.005 + decay * 6);
}

/** Run `build` against a fresh output at the current time, if sound is on and the context is awake. */
function play(build: (out: AudioNode, t: number) => void) {
  if (!ctx || !readSoundOn()) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const out = ctx.createGain();
    out.gain.value = 0.3;
    out.connect(ctx.destination);
    build(out, ctx.currentTime + 0.01);
  } catch {
    // Audio failed: the haptic still plays.
  }
}

/** Notes `len` apart; each rings ~len, the last rings `tail`. */
function arpeggio(out: AudioNode, t: number, notes: number[], len: number, tail: number, gain: number) {
  notes.forEach((f, i) => voice(out, "triangle", f, t + i * len, i === notes.length - 1 ? tail : len * 0.9, gain));
}

const A5 = 880, D6 = 1174.7, G6 = 1568, C7 = 2093, E7 = 2637, G7 = 3136, C8 = 4186;

/** Shutter: one short tap. */
export function fxCapture(): void {
  buzz(25);
  play((out, t) => {
    voice(out, "square", 2400, t, 0.012, 0.3);
    voice(out, "sine", 2400, t, 0.012, 0.5);
  });
}

export type RevealTier = "plain" | "nice" | "big" | "grail";

/** Match: a two-beat pattern; longer for a big one or a grail. */
export function fxMatch(tier: RevealTier): void {
  buzz(tier === "plain" ? [15, 40, 25] : tier === "nice" ? [20, 40, 40] : [30, 40, 30, 40, 60]);
  play((out, t) => {
    if (tier === "plain" || tier === "nice") arpeggio(out, t, [A5, D6, G6], 0.055, 0.18, 0.6);
    else if (tier === "big") arpeggio(out, t, [A5, D6, G6, C7], 0.055, 0.3, 0.6);
    else {
      arpeggio(out, t, [A5, D6, G6, C7, E7, C7, E7, G7], 0.06, 0.5, 0.55);
      voice(out, "triangle", C8, t + 0.5, 0.35, 0.12);
    }
  });
}

/** No match: a short double tap. */
export function fxMiss(): void {
  buzz([40, 30, 40]);
  play((out, t) => {
    voice(out, "square", 160, t, 0.1, 0.25, 147, 0.32);
    voice(out, "sine", 160, t, 0.1, 0.25, 147, 0.32);
  });
}

/**
 * How big a moment this is, from the market price. Thresholds are the
 * emotional ones, not statistical: $20 is "worth listing", $100 is "oh
 * nice", $500 is "hold on".
 */
export function revealTier(market: number | null): RevealTier {
  if (market == null || market < 20) return "plain";
  if (market < 100) return "nice";
  if (market < 500) return "big";
  return "grail";
}
