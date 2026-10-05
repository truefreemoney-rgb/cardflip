"use client";

/**
 * A live camera with no <video> element (10-05). TikTok's iPhone browser forces every playing video into its own
 * fullscreen player, so there the camera track goes to a worker (MediaStreamTrackProcessor, Safari 18+, worker-only)
 * and each frame is painted onto a canvas the scanner treats like its video. Unsupported anywhere = reject, and the
 * scanner falls back to the phone's own camera.
 */

// Plain JS for the worker: one frame in flight at a time, so a slow main thread drops frames instead of queueing them.
const WORKER_SRC = `
let reader = null;
let want = true;
self.onmessage = async (e) => {
  if (e.data === "next") { want = true; return; }
  if (e.data === "stop") { try { reader && reader.cancel(); } catch {} return; }
  if (typeof MediaStreamTrackProcessor === "undefined" || typeof createImageBitmap === "undefined") {
    self.postMessage({ type: "unsupported" });
    return;
  }
  const track = e.data.track;
  try {
    reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  } catch (err) {
    self.postMessage({ type: "unsupported" });
    return;
  }
  for (;;) {
    let r;
    try { r = await reader.read(); } catch { break; }
    if (r.done) break;
    const frame = r.value;
    if (!want) { frame.close(); continue; }
    want = false;
    try {
      const bmp = await createImageBitmap(frame);
      self.postMessage({ type: "frame", bmp }, [bmp]);
    } catch {
      want = true;
    }
    frame.close();
  }
  try { track.stop(); } catch {}
};
`;

/** Could this browser run the mirror at all (checked before asking for the camera). */
export function mirrorPossible(): boolean {
  return typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL.createObjectURL === "function";
}

export type CameraMirror = { stop: () => void };

/**
 * Sends the stream's video track to a worker and paints its frames onto canvas. Resolves once the first frame is
 * drawn (canvas sized to the frame, a "resize" event fired on it); rejects when the browser can't, or no frame comes
 * within 3 s. The track is the worker's after this call, so stop() is the only way to end it.
 */
export function startCameraMirror(stream: MediaStream, canvas: HTMLCanvasElement, onFrame?: () => void): Promise<CameraMirror> {
  return new Promise((resolve, reject) => {
    const track = stream.getVideoTracks()[0];
    if (!track) return reject(new Error("no video track"));
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    const ctx = canvas.getContext("2d");
    let settled = false;
    const stop = () => {
      worker.postMessage("stop");
      window.setTimeout(() => worker.terminate(), 200);
    };
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(why));
    };
    const timer = window.setTimeout(() => fail("no frame"), 3000);
    worker.onerror = () => fail("worker error");
    worker.onmessage = (e: MessageEvent<{ type: string; bmp?: ImageBitmap }>) => {
      if (e.data.type === "unsupported") return fail("unsupported");
      const bmp = e.data.bmp;
      if (e.data.type !== "frame" || !bmp || !ctx) return;
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.dispatchEvent(new Event("resize"));
      }
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      worker.postMessage("next");
      onFrame?.();
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve({ stop });
      }
    };
    try {
      // Transferable MediaStreamTrack is Safari 18+ too; older throws DataCloneError here.
      worker.postMessage({ track }, [track as unknown as Transferable]);
    } catch {
      window.clearTimeout(timer);
      fail("track not transferable");
    }
  });
}
