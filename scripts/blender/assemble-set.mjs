// Chain several card_reveal.py renders into one 9:16 video (10-20, set spotlight by Blender).
// Each card keeps frames 1..KEEP (the swoop, flip, price count-up, change line, brand), then hard-cuts to the next
// card's arrival. Writes "<label> - Pinterest etc (music).mp4" (track from OFFSET s, fades) and "<label> - TikTok
// (no music).mp4" (TikTok library sound only), plus "<label> cover.png" (first card, price landed).
// Run: node scripts/blender/assemble-set.mjs "<work dir>" "<label>" dir1 dir2 ...   (dirs under <work>/frames)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpeg from "ffmpeg-static";

const [work, label, ...dirs] = process.argv.slice(2);
const KEEP = Number(process.env.KEEP ?? 160); // 5.33 s per card at 30 fps
const FPS = 30;
const MUSIC = path.resolve("public/social/audio/bombinsound-upbeat-future-bass-version-3-so-easy-581623.mp3");
const OFFSET = Number(process.env.OFFSET ?? 28.2);
const tmp = path.join(work, "tmp"); fs.mkdirSync(tmp, { recursive: true });
const run = (args) => execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });

// 1) one silent clip per card from its PNG frames
const parts = [];
for (const d of dirs) {
  const frames = path.join(work, "frames", d);
  const n = fs.readdirSync(frames).filter((f) => /^f_\d{4}\.png$/.test(f)).length;
  if (n < KEEP) throw new Error(`${d}: only ${n} frames`);
  const clip = path.join(tmp, `${d}.mp4`);
  run(["-framerate", String(FPS), "-start_number", "1", "-i", path.join(frames, "f_%04d.png"), "-frames:v", String(KEEP),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium", clip]);
  parts.push(clip);
}
// 2) concat
const list = path.join(tmp, "list.txt");
fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
const silent = path.join(work, `${label} - TikTok (no music).mp4`);
run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);
const total = (parts.length * KEEP) / FPS;
// 3) music version
const music = path.join(work, `${label} - Pinterest etc (music).mp4`);
run(["-i", silent, "-ss", String(OFFSET), "-i", MUSIC, "-filter_complex", `[1:a]atrim=0:${total},afade=t=in:st=0:d=0.25,afade=t=out:st=${(total - 0.9).toFixed(2)}:d=0.9[a]`,
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", music]);
// 4) cover: first card with the price landed and the change line up (frame 130)
fs.copyFileSync(path.join(work, "frames", dirs[0], "f_0130.png"), path.join(work, `${label} cover.png`));
console.log(`done: ${parts.length} cards, ${total.toFixed(1)} s\n${silent}\n${music}`);
