// X ad assembly (10-26): frames/<scene>/f_%04d.png -> "<scene> (no music).mp4" + "<scene> (music).mp4" + "<scene> cover.png"
// (square, H.264 yuv420p + AAC = X's video spec). X autoplays muted; the music copy is the one to upload (sound if
// the viewer unmutes). node scripts/blender/ad-x/assemble.mjs "<work dir>" [scene ...]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "ffmpeg-static";

const [work, ...only] = process.argv.slice(2);
const FPS = 30;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MUSIC = path.join(repo, "public/social/audio/bombinsound-upbeat-future-bass-version-3-so-easy-581623.mp3");
const run = (args) => execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
const framesRoot = path.join(work, "frames");
const scenes = (only.length ? only : fs.readdirSync(framesRoot)).filter((d) => fs.statSync(path.join(framesRoot, d)).isDirectory());
for (const d of scenes) {
  const dir = path.join(framesRoot, d);
  const n = fs.readdirSync(dir).filter((f) => /^f_\d{4}\.png$/.test(f)).length;
  if (!n) { console.log(`${d}: no full frames, skipped`); continue; }
  const silent = path.join(work, `${d} (no music).mp4`);
  run(["-framerate", String(FPS), "-start_number", "1", "-i", path.join(dir, "f_%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", silent]);
  fs.copyFileSync(path.join(dir, `f_${String(n).padStart(4, "0")}.png`), path.join(work, `${d} cover.png`));
  const total = n / FPS, OFFSET = Number(process.env.OFFSET ?? 28.2);
  const withMusic = path.join(work, `${d} (music).mp4`);
  run(["-i", silent, "-ss", String(OFFSET), "-i", MUSIC, "-filter_complex", `[1:a]atrim=0:${total},afade=t=in:st=0:d=0.25,afade=t=out:st=${(total - 0.9).toFixed(2)}:d=0.9[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", withMusic]);
  console.log(`${d}: ${n} frames (${total.toFixed(1)} s) -> ${path.basename(silent)}, ${path.basename(withMusic)}, cover`);
}
