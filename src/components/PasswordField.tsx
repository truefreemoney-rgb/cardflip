"use client";

import { useState, type InputHTMLAttributes } from "react";

/**
 * A password input with an eye toggle and, for new passwords, a live length
 * hint — the same behaviour on signup, reset and the account page so nobody
 * types a password blind twice and gets "doesn't match" for a typo.
 */

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  /** Show the "n more characters / long enough" hint (new passwords). */
  hint?: boolean;
  /** Minimum length the hint counts toward. Signup enforces 6. */
  minLength?: number;
  className: string;
};

export default function PasswordField({ hint = false, minLength = 6, className, value, ...rest }: Props) {
  const [show, setShow] = useState(false);
  const len = typeof value === "string" ? value.length : 0;
  const hintText =
    len === 0 ? `At least ${minLength} characters` : len >= minLength ? "Long enough" : `${minLength - len} more character${minLength - len === 1 ? "" : "s"}`;
  const hintCls = len === 0 ? "text-zinc-600" : len >= minLength ? "text-emerald-400" : "text-amber-300";

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <input {...rest} value={value} type={show ? "text" : "password"} className={`${className} w-full pr-11`} />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-zinc-500 transition hover:text-zinc-200"
        >
          {show ? (
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.9 5.1A10.4 10.4 0 0 1 12 4.9c5 0 8.6 3.6 10 7.1a11.6 11.6 0 0 1-2.6 3.8M6.5 6.5C4.4 7.9 2.9 9.9 2 12c1.4 3.5 5 7.1 10 7.1 1.7 0 3.2-.4 4.6-1.1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 12c1.4-3.5 5-7.1 10-7.1s8.6 3.6 10 7.1c-1.4 3.5-5 7.1-10 7.1S3.4 15.5 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {hint && (
        <span className={`text-[11px] ${hintCls}`} aria-live="polite">
          {hintText}
        </span>
      )}
    </div>
  );
}
