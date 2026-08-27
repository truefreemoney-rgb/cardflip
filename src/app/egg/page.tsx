"use client";

/**
 * /egg — the secret skeleton theater. Not linked from anywhere on purpose:
 * an easter egg is only an egg if you have to know the URL (Chris, 08-27).
 * Everything is self-contained — CSS curtains, inline-SVG skeletons, and a
 * WebAudio "doot" tune written for this page (an original spooky riff, not
 * any recorded song) — so it ships with zero assets and no licensing.
 * Audio starts on the click that opens the curtain, which is also what
 * browser autoplay policy demands.
 */

import { useEffect, useRef, useState } from "react";

// E-minor doot riff, 8th notes. 0 = rest. Frequencies, not note names,
// so the sequencer stays dumb. Written by ear for this page.
const RIFF = [
  330, 0, 330, 392, 330, 294, 247, 294,
  330, 0, 330, 392, 494, 440, 392, 330,
  247, 247, 294, 330, 392, 330, 294, 247,
  220, 0, 247, 0, 330, 330, 330, 0,
];
const STEP_S = 0.22;

function useDootBand(playing: boolean) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!playing) return;
    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    let step = 0;

    const doot = (freq: number, at: number) => {
      // Square + light lowpass reads "toy trumpet" without any samples.
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = "square";
      osc.frequency.value = freq;
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + STEP_S * 0.85);
      osc.connect(filter).connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + STEP_S);
    };
    const thump = (at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(110, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.1);
      gain.gain.setValueAtTime(0.5, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.14);
    };
    const tick = (at: number) => {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = 0.07;
      src.buffer = buf;
      src.connect(gain).connect(ctx.destination);
      src.start(at);
    };

    timerRef.current = setInterval(() => {
      const at = ctx.currentTime + 0.05;
      const note = RIFF[step % RIFF.length];
      if (note > 0) doot(note, at);
      if (step % 4 === 0) thump(at);
      if (step % 2 === 1) tick(at);
      setBeat(step);
      step++;
    }, STEP_S * 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      void ctx.close();
    };
  }, [playing]);

  return beat;
}

/** One cartoon skeleton, instrument chosen by prop. Bobs on the beat. */
function Skeleton({
  instrument,
  flip,
  beat,
}: {
  instrument: "trumpet" | "drum" | "bones";
  flip?: boolean;
  beat: number;
}) {
  const bob = beat % 2 === 0;
  const sway = bob ? -2 : 2;
  return (
    <div
      className="egg-skel"
      style={{
        transform: (flip ? "scaleX(-1) " : "") + "translateY(" + (bob ? "-6px" : "0px") + ") rotate(" + sway + "deg)",
      }}
    >
      <svg viewBox="0 0 120 190" width="150" height="238" aria-hidden>
        {/* skull */}
        <ellipse cx="60" cy="34" rx="26" ry="24" fill="#e8e4d8" />
        <rect x="48" y="50" width="24" height="14" rx="4" fill="#e8e4d8" />
        <circle cx="50" cy="32" r="6" fill="#0b0b10" />
        <circle cx="70" cy="32" r="6" fill="#0b0b10" />
        <path d="M56 44 l4 6 l4 -6 z" fill="#0b0b10" />
        {/* teeth */}
        {[46, 52, 58, 64, 70].map((x) => (
          <rect key={x} x={x} y="56" width="4" height="7" fill="#0b0b10" opacity="0.5" />
        ))}
        {/* spine + ribs */}
        <rect x="57" y="64" width="6" height="52" rx="3" fill="#e8e4d8" />
        {[74, 86, 98].map((y, i) => (
          <ellipse key={y} cx="60" cy={y} rx={26 - i * 4} ry="5" fill="none" stroke="#e8e4d8" strokeWidth="5" />
        ))}
        {/* pelvis */}
        <ellipse cx="60" cy="120" rx="16" ry="8" fill="#e8e4d8" />
        {/* legs */}
        <rect x="46" y="126" width="6" height="34" rx="3" fill="#e8e4d8" transform={"rotate(" + (bob ? -6 : 6) + " 49 126)"} />
        <rect x="68" y="126" width="6" height="34" rx="3" fill="#e8e4d8" transform={"rotate(" + (bob ? 6 : -6) + " 71 126)"} />
        <ellipse cx="45" cy="164" rx="9" ry="5" fill="#e8e4d8" />
        <ellipse cx="75" cy="164" rx="9" ry="5" fill="#e8e4d8" />
        {/* arms + instrument */}
        {instrument === "trumpet" && (
          <g transform={"rotate(" + (bob ? -8 : 2) + " 60 70)"}>
            <rect x="62" y="68" width="30" height="6" rx="3" fill="#e8e4d8" />
            <rect x="88" y="62" width="22" height="8" rx="2" fill="#d4af37" />
            <path d="M108 56 l10 10 l-10 4 z" fill="#d4af37" />
            <circle cx="94" cy="60" r="2.5" fill="#d4af37" />
            <circle cx="100" cy="60" r="2.5" fill="#d4af37" />
          </g>
        )}
        {instrument === "drum" && (
          <g>
            <rect x="20" y="120" width="34" height="24" rx="4" fill="#8b2635" stroke="#d4af37" strokeWidth="2" />
            <ellipse cx="37" cy="120" rx="17" ry="5" fill="#e8e4d8" />
            <rect x="26" y="80" width="5" height="34" rx="2.5" fill="#e8e4d8" transform={"rotate(" + (bob ? 30 : 10) + " 28 80)"} />
            <rect x="80" y="80" width="5" height="34" rx="2.5" fill="#e8e4d8" transform={"rotate(" + (bob ? -35 : -12) + " 82 80)"} />
          </g>
        )}
        {instrument === "bones" && (
          <g>
            <rect x="18" y="70" width="6" height="26" rx="3" fill="#e8e4d8" transform={"rotate(" + (bob ? -25 : 15) + " 21 70)"} />
            <rect x="96" y="70" width="6" height="26" rx="3" fill="#e8e4d8" transform={"rotate(" + (bob ? 25 : -15) + " 99 70)"} />
            {/* xylophone of femurs */}
            {[0, 1, 2, 3].map((i) => (
              <rect key={i} x={30 + i * 16} y="128" width="12" height={30 - i * 4} rx="5" fill="#e8e4d8" stroke="#0b0b10" strokeWidth="1" />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

const STAGE_CSS = `
.egg-root { min-height: 100dvh; background: radial-gradient(ellipse at 50% 30%, #1a1024 0%, #0b0b10 70%);
  overflow: hidden; position: relative; font-family: Georgia, serif; }
.egg-boards { position: absolute; bottom: 0; left: 0; right: 0; height: 18dvh;
  background: repeating-linear-gradient(90deg, #2a1a12 0 90px, #21140e 90px 180px); }
.egg-spot { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 1.6s ease 0.8s;
  background: radial-gradient(ellipse 42% 55% at 50% 62%, rgba(255,240,200,0.14), transparent 70%); }
.egg-root.open .egg-spot { opacity: 1; }
.egg-band { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  display: flex; gap: 1.5rem; align-items: flex-end; padding-bottom: 8dvh;
  filter: drop-shadow(0 12px 24px rgba(0,0,0,0.7)); }
.egg-skel { transition: transform 0.18s ease; }
.egg-curtain { position: absolute; top: 0; bottom: 0; width: 52%; z-index: 10;
  background: repeating-linear-gradient(90deg, #7a1220 0 34px, #5c0d18 34px 68px);
  box-shadow: inset 0 -40px 60px rgba(0,0,0,0.55); transition: transform 2.2s cubic-bezier(0.7, 0, 0.3, 1); }
.egg-curtain.left { left: 0; border-right: 10px solid #d4af37; }
.egg-curtain.right { right: 0; border-left: 10px solid #d4af37; }
.egg-root.open .egg-curtain.left { transform: translateX(-104%); }
.egg-root.open .egg-curtain.right { transform: translateX(104%); }
.egg-valance { position: absolute; top: 0; left: 0; right: 0; height: 9dvh; z-index: 11;
  background: repeating-linear-gradient(90deg, #8a1725 0 40px, #6b1020 40px 80px);
  border-bottom: 6px solid #d4af37; border-radius: 0 0 40% 40% / 0 0 60% 60%; }
.egg-button { position: absolute; z-index: 12; left: 50%; top: 55%; transform: translate(-50%, -50%);
  background: #d4af37; color: #241303; border: none; border-radius: 999px; padding: 1rem 2.4rem;
  font-size: 1.1rem; font-weight: 700; letter-spacing: 0.08em; cursor: pointer;
  box-shadow: 0 8px 30px rgba(212,175,55,0.35); transition: opacity 0.5s, transform 0.2s; }
.egg-button:hover { transform: translate(-50%, -52%); }
.egg-root.open .egg-button { opacity: 0; pointer-events: none; }
.egg-doot { position: absolute; z-index: 5; color: #e8e4d8; opacity: 0.85; font-size: 1.3rem;
  animation: egg-float 1.4s ease-out forwards; }
@keyframes egg-float { from { transform: translateY(0); opacity: 0.85; } to { transform: translateY(-90px); opacity: 0; } }
.egg-title { position: absolute; bottom: 3dvh; left: 0; right: 0; text-align: center; color: #d4af37;
  letter-spacing: 0.3em; font-size: 0.8rem; opacity: 0; transition: opacity 1s ease 2.4s; z-index: 6; }
.egg-root.open .egg-title { opacity: 0.9; }
`;

export default function EggPage() {
  const [open, setOpen] = useState(false);
  const beat = useDootBand(open);

  return (
    <div className={open ? "egg-root open" : "egg-root"}>
      <style>{STAGE_CSS}</style>

      <div className="egg-boards" />
      <div className="egg-spot" />

      <div className="egg-band">
        <Skeleton instrument="drum" beat={beat} />
        <Skeleton instrument="trumpet" beat={beat + 1} />
        <Skeleton instrument="bones" flip beat={beat} />
        {open && beat % 4 === 0 && (
          <span className="egg-doot" style={{ left: (30 + ((beat * 37) % 40)) + "%", top: "10%" }}>
            doot doot 🎺
          </span>
        )}
      </div>

      <div className="egg-valance" />
      <div className="egg-curtain left" />
      <div className="egg-curtain right" />

      <button type="button" className="egg-button" onClick={() => setOpen(true)}>
        🎭 THE SHOW
      </button>

      <div className="egg-title">THE CARDFLIP PHILHARMONIC · BONE DIVISION</div>
    </div>
  );
}
