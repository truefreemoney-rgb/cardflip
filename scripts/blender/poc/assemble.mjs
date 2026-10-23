// POC assembly (10-23): frames/<scene>/f_%04d.png -> "<scene> (no music).mp4" + "<scene> cover.png" + a safe-zone
// contact sheet (frames 40/80/135 with TikTok's covered zones shaded: top 13%, bottom 22%).
// node scripts/blender/poc/assemble.mjs "<work dir>" [scene ...]   (default: every folder under <work>/frames)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpeg from "ffmpeg-static";

const [work, ...only] = process.argv.slice(2);
const FPS = 30;
const run = (args) => execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
const framesRoot = path.join(work, "frames");
const scenes = (only.length ? only : fs.readdirSync(framesRoot)).filter((d) => fs.statSync(path.join(framesRoot, d)).isDirectory());
const shade = "drawbox=x=0:y=0:w=iw:h=ih*0.13:color=black@0.55:t=fill,drawbox=x=0:y=ih*0.78:w=iw:h=ih*0.22:color=black@0.55:t=fill";
for (const d of scenes) {
  const dir = path.join(framesRoot, d);
  const full = fs.readdirSync(dir).filter((f) => /^f_\d{4}\.png$/.test(f)).length;
  const stills = fs.readdirSync(dir).filter((f) => /^still_\d{4}\.png$/.test(f)).sort();
  if (full) {
    const mp4 = path.join(work, `${d} (no music).mp4`);
    run(["-framerate", String(FPS), "-start_number", "1", "-i", path.join(dir, "f_%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium", mp4]);
    const coverN = Math.min(full, Number(process.env.COVER ?? 135));
    fs.copyFileSync(path.join(dir, `f_${String(coverN).padStart(4, "0")}.png`), path.join(work, `${d} cover.png`));
    console.log(`${d}: ${full} frames -> ${mp4}`);
    if (process.env.MUSIC !== "0") {  // other sites keep the music; TikTok gets a library sound at post time
      const MUSIC = path.resolve("public/social/audio/bombinsound-upbeat-future-bass-version-3-so-easy-581623.mp3");
      const OFFSET = Number(process.env.OFFSET ?? 28.2), total = full / FPS;
      const withMusic = path.join(work, `${d} (music).mp4`);
      run(["-i", mp4, "-ss", String(OFFSET), "-i", MUSIC, "-filter_complex", `[1:a]atrim=0:${total},afade=t=in:st=0:d=0.25,afade=t=out:st=${(total - 0.9).toFixed(2)}:d=0.9[a]`,
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", withMusic]);
      console.log(`${d}: music -> ${withMusic}`);
    }
  }
  const sheetSrc = stills.length ? stills : full ? ["f_0040.png", "f_0080.png", "f_0135.png"].filter((f) => fs.existsSync(path.join(dir, f))) : [];
  if (sheetSrc.length) {
    const inputs = sheetSrc.flatMap((f) => ["-i", path.join(dir, f)]);
    const fc = sheetSrc.map((_, i) => `[${i}:v]scale=360:640,${shade}[s${i}]`).join(";") + ";" + sheetSrc.map((_, i) => `[s${i}]`).join("") + `hstack=inputs=${sheetSrc.length}[o]`;
    run([...inputs, "-filter_complex", fc, "-map", "[o]", "-q:v", "3", path.join(work, `${d} sheet.jpg`)]);
    console.log(`${d}: sheet from ${sheetSrc.join(", ")}`);
  }
}
