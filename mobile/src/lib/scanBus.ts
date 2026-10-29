/**
 * The native scanner's results, handed to the Scanner tab's web page in place (10-29): scan.tsx emits the
 * session's ledger ids (the tapped one first) as it closes; (app)/scanTab.tsx, which stays mounted under
 * it, injects them into the site's /app page as a "cardflip:resume" event, so the queue keeps what it had
 * and the new rows join it, like the site's own camera sheet closing. Returns whether anyone listened, so
 * the scanner can fall back to reloading the tab with ?resume= when the page is not there.
 */
export type ScanResult = { ids: string[] };

const listeners = new Set<(r: ScanResult) => void>();

export function onScanResult(fn: (r: ScanResult) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitScanResult(r: ScanResult): boolean {
  for (const fn of listeners) fn(r);
  return listeners.size > 0;
}
