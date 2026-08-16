"use client";

/**
 * The feel of a scan: a shutter tick when the card is captured, a chime
 * when it's identified (a third note when it's a big one), and a haptic tap
 * on phones that support it. All synthesised — no audio assets, nothing to
 * load — and all opt-out (the HUD's sound toggle, remembered in
 * localStorage). Haptics ride the same toggle.
 *
 * Browsers only let audio start from a user gesture, and the auto-scanner
 * captures without one, so `primeScanFx()` is called from the tap that opens
 * the camera (and any tap inside the viewfinder) to create + resume the
 * AudioContext while a gesture is live. After that it plays freely.
 */

const PREF_KEY = "cardflip.scanFx";

let ctx: AudioContext | null = null;

export function scanFxEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(PREF_KEY) !== "off";
}

export function setScanFxEnabled(on: boolean): void {
  window.localStorage.setItem(PREF_KEY, on ? "on" : "off");
  if (on) void primeScanFx();
}

/** Create/resume the audio context inside a user gesture. Safe to repeat. */
export async function primeScanFx(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    ctx = null;
  }
}

function live(): AudioContext | null {
  return ctx && ctx.state === "running" ? ctx : null;
}

function tone(
  ac: AudioContext,
  freq: number,
  at: number,
  dur: number,
  gain: number,
  type: OscillatorType = "sine",
) {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS) — silent no-op.
  }
}

/** Shutter: a short filtered noise tick + a tap. */
export function fxCapture(): void {
  if (!scanFxEnabled()) return;
  buzz(25);
  const ac = live();
  if (!ac) return;
  const at = ac.currentTime;
  const len = Math.floor(ac.sampleRate * 0.05);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2400;
  filter.Q.value = 1.2;
  const env = ac.createGain();
  env.gain.value = 0.35;
  src.connect(filter).connect(env).connect(ac.destination);
  src.start(at);
}

export type RevealTier = "plain" | "nice" | "big" | "grail";

/** Match: two rising notes; three for a big one, four for a grail. */
export function fxMatch(tier: RevealTier): void {
  if (!scanFxEnabled()) return;
  buzz(tier === "plain" ? [15, 40, 25] : tier === "nice" ? [20, 40, 40] : [30, 40, 30, 40, 60]);
  const ac = live();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  const notes =
    tier === "grail"
      ? [523.25, 659.25, 783.99, 1046.5]
      : tier === "big"
        ? [587.33, 739.99, 987.77]
        : [659.25, 880];
  notes.forEach((f, i) => tone(ac, f, at + i * 0.09, 0.28, i === notes.length - 1 ? 0.16 : 0.11));
  if (tier === "grail" || tier === "big") {
    // a soft shimmer under the last note
    tone(ac, notes[notes.length - 1] * 2, at + notes.length * 0.09, 0.5, 0.03, "triangle");
  }
}

/** No match: one low, short note. */
export function fxMiss(): void {
  if (!scanFxEnabled()) return;
  buzz([40, 30, 40]);
  const ac = live();
  if (!ac) return;
  tone(ac, 220, ac.currentTime + 0.01, 0.22, 0.09, "triangle");
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
