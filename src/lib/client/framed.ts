/**
 * True inside the admin heat map's page preview (/admin/heatmap shows the
 * live page in an iframe). Counters and pop-ups stay off there, so looking
 * at the map never adds visits, taps or analytics hits of its own.
 */
export function inPreviewFrame(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    // A cross-origin parent throws on access: also framed.
    return true;
  }
}
