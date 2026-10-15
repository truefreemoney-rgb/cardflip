import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Dev only (10-15): the scanner's ?dbg=outline mode posts a camera frame
 * plus its geometry here every couple of seconds, so the live outline's
 * edge finder can be run and tuned on Chris's real phone frames offline
 * instead of test-after-test on his phone. Files land in .outline-dumps/
 * (gitignored). 404 in production.
 */
/** GET ?file=<stamp> serves one recorded frame back (dev only), so the pane can feed a real phone photo through the scanner. */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const stamp = new URL(req.url).searchParams.get("file") ?? "";
  if (!/^[\w-]+$/.test(stamp)) return new NextResponse(null, { status: 400 });
  try {
    const buf = await readFile(path.join(process.cwd(), ".outline-dumps", `${stamp}.jpg`));
    return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "image/jpeg" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const body = (await req.json()) as { frame: string; meta: unknown };
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(body.frame ?? "");
  if (!m) return NextResponse.json({ error: "no jpeg" }, { status: 400 });
  const dir = path.join(process.cwd(), ".outline-dumps");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(path.join(dir, `${stamp}.jpg`), Buffer.from(m[1], "base64"));
  await writeFile(path.join(dir, `${stamp}.json`), JSON.stringify(body.meta, null, 2));
  return NextResponse.json({ ok: true, stamp });
}
