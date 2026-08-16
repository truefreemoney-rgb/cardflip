/**
 * Stream a very large JSON document and hand back each object that opens at a
 * given nesting depth, without ever holding the whole file. Depth is counted
 * on `{`/`[` outside strings; strings are skipped with escape handling.
 *
 *   `[ {…}, {…} ]`                    → itemDepth 2 (root array is depth 1)
 *   `{ "meta": {…}, "data": { "k": {…} } }` → itemDepth 3 (see the MTGJSON
 *   backfill script, which does the same with an extra "data" key check)
 *
 * Used for Scryfall's bulk `default_cards` (~150 MB) on the 512 MB Fly box.
 * No "server-only" marker so scripts can drive it from plain node.
 */
export async function streamJsonObjects(
  body: ReadableStream<Uint8Array>,
  itemDepth: number,
  onObject: (obj: unknown) => void,
): Promise<number> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let depth = 0;
  let inString = false;
  let escape = false;
  let capturing = false;
  let buf: string[] = [];
  let count = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    // Start of the captured run inside `text`; a capture that began in an
    // earlier chunk continues from this chunk's first character.
    let segStart = capturing ? 0 : -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{" || ch === "[") {
        depth++;
        if (depth === itemDepth && !capturing) { capturing = true; segStart = i; }
        continue;
      }
      if (ch === "}" || ch === "]") {
        if (capturing && depth === itemDepth) {
          buf.push(text.slice(segStart, i + 1));
          const json = buf.join("");
          buf = [];
          capturing = false;
          segStart = -1;
          try { onObject(JSON.parse(json)); count++; } catch { /* skip malformed */ }
        }
        depth--;
        continue;
      }
    }
    if (capturing && segStart >= 0) buf.push(text.slice(segStart));
  }
  return count;
}
