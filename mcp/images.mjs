// Images for tool results: JPEG, at most 1600 px wide and 1 MB, made with the tool home's ffmpeg.
// Before setup there is no ffmpeg, so the answer is null and callers return text only.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { tryEnv } from "./context.mjs";

export const MAX_WIDTH = 1600;
export const MAX_BYTES = 1024 * 1024;
const QUALITIES = [3, 6, 10, 16, 24, 31];
const WIDTHS = [MAX_WIDTH, 1200, 900, 600];
const FFMPEG_TIMEOUT_MS = 20000;

function ffmpegJpeg(ffmpeg, file, width, quality) {
  return new Promise((resolve) => {
    const args = ["-v", "error", "-y", "-i", file, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-pix_fmt", "yuvj420p", "-q:v", String(quality), "-f", "mjpeg", "pipe:1"];
    const child = spawn(ffmpeg, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null);
    });
  });
}

// MCP image content for a picture file, or null when it cannot be made (no ffmpeg yet, unreadable file).
export async function imageContent(file) {
  const env = tryEnv();
  if (!env?.ffmpeg || !fs.existsSync(env.ffmpeg) || !fs.existsSync(file)) return null;
  for (const width of WIDTHS) {
    for (const quality of QUALITIES) {
      const data = await ffmpegJpeg(env.ffmpeg, file, width, quality);
      if (data === null) return null;
      if (data.length <= MAX_BYTES) return { type: "image", data: data.toString("base64"), mimeType: "image/jpeg" };
    }
  }
  return null;
}
