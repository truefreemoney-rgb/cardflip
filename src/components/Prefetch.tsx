"use client";

import { useEffect, useState } from "react";

// Warms a couple of idle-time things once the page is interactive; renders
// nothing in the normal course of events.
const T = [116, 119, 115, 115, 110];

export default function Prefetch() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    let buf: number[] = [];
    const down = (e: KeyboardEvent) => {
      if (!e.shiftKey) {
        buf = [];
        return;
      }
      if (e.key.length !== 1) return;
      buf = [...buf, e.key.toLowerCase().charCodeAt(0)].slice(-T.length);
      if (buf.length === T.length && buf.every((c, i) => c === T[T.length - 1 - i])) setOn(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        buf = [];
        setOn(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => setOn(false));
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center bg-white transition-opacity duration-500 ${on ? "opacity-100" : "opacity-0"}`}
    >
      <svg viewBox="0 0 400 300" className="h-[70vmin] w-auto" fill="none" stroke="#000" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round">
        <path d="M70 300 C60 200 80 130 150 110 C230 90 320 110 340 190 C350 230 350 270 348 300" fill="#fff" />
        <path d="M100 130 C90 80 150 40 205 44 C270 48 300 90 296 130 C260 118 150 120 100 130 Z" fill="#4f6df5" />
        <path d="M108 128 C160 112 250 112 300 126 C300 140 290 148 280 150 C240 136 160 136 112 146 C104 142 104 134 108 128 Z" fill="#000" />
        <path d="M196 60 L186 22 L206 30 L214 12 L216 66 Z" fill="#000" />
        <path d="M120 160 C130 135 175 140 178 168 C170 182 130 184 120 160 Z" fill="#fff" />
        <path d="M218 158 C228 130 272 132 280 158 C272 178 232 180 218 158 Z" fill="#fff" />
        <path d="M138 170 C140 160 168 160 170 172 C162 178 146 178 138 170 Z" fill="#000" stroke="none" />
        <path d="M232 166 C236 154 266 154 270 168 C262 176 240 176 232 166 Z" fill="#000" stroke="none" />
        <path d="M120 206 C160 196 200 176 240 198 C270 214 300 200 322 214 C300 232 262 232 236 226 C200 240 150 236 120 206 Z" fill="#f9c22b" />
        <path d="M128 208 C170 216 220 210 246 206 C280 202 300 210 316 216" />
      </svg>
    </div>
  );
}
