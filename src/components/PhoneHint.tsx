/**
 * "Best on your phone" (Chris, 10-07): a Google Ads visitor landed on the
 * scanner from a computer. Shown only where the main pointer is a mouse, so
 * phones and tablets never see it.
 */
export default function PhoneHint() {
  return (
    <p className="hidden rounded-full border border-edge bg-surface-1 px-3 py-1.5 text-center text-xs text-zinc-300 pointer-fine:block">
      Works best on your phone. Open <span className="font-semibold text-white">cardflip.io</span> there to scan.
    </p>
  );
}
