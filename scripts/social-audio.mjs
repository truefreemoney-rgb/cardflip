// Backing track for the social videos, synthesized (no samples, no downloads),
// so CardFlip owns it outright. A soft pad on Am-F-C-G, one chord per card
// beat (2.1s = 114 bpm bars), a low kick pulse and a light hat on the off
// beats. Deterministic: same expression, same bytes.
//
//   node scripts/social-audio.mjs [--out public/social/audio/spotlight-114bpm.mp3] [--seconds 24]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg("--out", "public/social/audio/spotlight-114bpm.mp3"));
const SECONDS = Number(arg("--seconds", 24));
const BAR = 2.1;            // matches BEAT in social-video.mjs
const PULSE = BAR / 4;      // 114 bpm quarter notes

// Chord tones (Hz), low to high. Index k cycles Am, F, C, G.
const chords = [
  [110, 130.81, 164.81, 220],     // Am
  [87.31, 110, 130.81, 174.61],   // F
  [130.81, 164.81, 196, 261.63],  // C
  [98, 123.47, 146.83, 196],      // G
];
const pick = (voice) =>
  `if(eq(ld(0),0),${chords[0][voice]},if(eq(ld(0),1),${chords[1][voice]},if(eq(ld(0),2),${chords[2][voice]},${chords[3][voice]})))`;

// st(0) = chord index, st(1) = time inside the bar, st(2) = pad envelope.
// The bar clock is offset 2.0s so the first change lands 0.1s in, then every
// 2.1s: chord changes fall on the card changes (intro is 2.2s).
const padVoice = (v, gain) => `${gain}*(sin(2*PI*${pick(v)}*t)+0.6*sin(2*PI*${pick(v)}*1.004*t)+0.25*sin(2*PI*${pick(v)}*2*t))`;
const pad = `st(0,mod(floor((t+2.0)/${BAR}),4))*0+st(1,mod(t+2.0,${BAR}))*0+st(2,min(ld(1)/0.35,1)*(1-0.25*ld(1)/${BAR}))*0+ld(2)*(` +
  [padVoice(0, 0.16), padVoice(1, 0.14), padVoice(2, 0.12), padVoice(3, 0.09)].join("+") + ")";
const kick = `0.55*sin(2*PI*(48+90*exp(-mod(t,${PULSE})*35))*mod(t,${PULSE}))*exp(-mod(t,${PULSE})*14)`;
const hat = `0.05*random(0)*exp(-mod(t+${PULSE / 2},${PULSE})*60)`;
// Commas separate filters in a lavfi graph, so escape the ones inside the expression.
const expr = `${pad}+${kick}+${hat}`.replace(/,/g, String.fromCharCode(92) + ",");

const ffmpeg = (await import("ffmpeg-static")).default;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const r = spawnSync(ffmpeg, [
  "-y", "-f", "lavfi", "-i", `aevalsrc=${expr}:s=44100:d=${SECONDS}`,
  "-af", "lowpass=f=2400,highpass=f=40,acompressor=threshold=-14dB:ratio=3:attack=8:release=120,volume=5dB,afade=t=in:d=0.3",
  "-ac", "2", "-codec:a", "libmp3lame", "-b:a", "160k", OUT,
], { stdio: ["ignore", "ignore", "pipe"] });
if (r.status !== 0) { console.error(r.stderr.toString().slice(-2000)); process.exit(1); }
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e3).toFixed(0)} KB, ${SECONDS}s)`);
