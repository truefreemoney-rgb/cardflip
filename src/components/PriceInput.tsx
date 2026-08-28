"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A price field that behaves like money instead of like a number input.
 * The raw `type="number"` it replaces kept whatever the keyboard produced
 * ("05.00", "5.", "0005") because the controlled value round-tripped
 * through parseFloat on every keystroke (Chris, 08-28: "make it work
 * normally like currency"). This one edits a local string — digits and
 * one dot, two decimals — then snaps to X.XX on blur, and selects itself
 * on focus so typing replaces instead of appending to the "0.00".
 */
export default function PriceInput({
  value,
  onValue,
  onCommit,
  className,
}: {
  value: number;
  onValue: (price: number) => void;
  /** Fired on blur with the final parsed price (ledger sync etc.). */
  onCommit?: (price: number) => void;
  className?: string;
}) {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);

  // An outside reprice (quote landing, condition change) updates the field —
  // but never while the seller is mid-keystroke in it.
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);

  const parse = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onChange={(e) => {
        // Digits and at most one dot with two decimals; strip everything
        // else (currency symbols, commas, stray leading zeros).
        let s = e.target.value.replace(/[^0-9.]/g, "");
        const firstDot = s.indexOf(".");
        if (firstDot !== -1) {
          s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
        }
        s = s.replace(/^0+(?=\d)/, "");
        setText(s);
        onValue(parse(s));
      }}
      onBlur={() => {
        focused.current = false;
        const n = parse(text);
        setText(fmt(n));
        onCommit?.(n);
      }}
      className={className}
    />
  );
}
