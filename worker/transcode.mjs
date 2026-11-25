// Browser-safe preview generation with ffmpeg.
// Output: H.264 High / AAC MP4, longest side <= 1280, +faststart (progressive
// playback on 4G), plus a JPEG poster frame. Aspect ratio is preserved; no crop.
import { spawn } from "node:child_process";

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${err}`))));
  });
}

export async function makePreview(input, outMp4, outJpg) {
  await run("ffmpeg", [
    "-y", "-i", input,
    "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-profile:v", "high", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    outMp4,
  ]);
  await run("ffmpeg", ["-y", "-ss", "0.5", "-i", outMp4, "-frames:v", "1", "-q:v", "4", outJpg]);
}

export async function probe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", file]);
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffprobe failed"));
      const j = JSON.parse(out);
      const s = j.streams?.[0] ?? {};
      resolve({ width: s.width ?? null, height: s.height ?? null, codec: s.codec_name ?? null, duration: Number(j.format?.duration ?? 0) || null });
    });
  });
}
