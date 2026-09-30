#!/usr/bin/env node
// T7s and LITE.md 7.9 C: the footage warning of `cut`. Makes two short clips, one whose audio stream starts 0.2 s after its
// video and one clean clip, runs `cut` on a project for each, and asserts the warning appears for the first only.
// Usage: node test/harness/late-audio-clip.mjs [--keep]
//        node test/harness/late-audio-clip.mjs --make <folder>     (only writes late.mp4 and clean.mp4 there)
// Constants, fixed before the first run. From LITE.md 7.9 C: warn when the audio and video start times differ by more than 1 frame.
//   AUDIO_DELAY 0.2 s (T7s); the fixture is checked with ffprobe to really differ by more than one frame at 30 fps.
//   WARNING_LINE: an output line containing "warn" (or starting with "!"), "audio" and "start" or "offset". The wording of the
//   warning is not fixed by LITE.md, so the match is deliberately loose; the clean clip must produce no such line.
import fs from "node:fs";
import path from "node:path";
import { EXIT, line, exitFor, usage, loadEnv, ffmpeg, probe, studio, tempDir, rmDir, isMain } from "./lib.mjs";

export const AUDIO_DELAY = 0.2, FPS = 30, CLIP_SECONDS = 2;
export const WARNING_LINE = (text) => text.split("\n").filter((l) => (/warn/i.test(l) || /^\s*!/.test(l)) && /audio/i.test(l) && /(start|offset)/i.test(l));

// late.mp4: audio stream starts AUDIO_DELAY after the video (ffmpeg -itsoffset on the audio input); clean.mp4: both start together
export function makeClips(env, folder) {
  fs.mkdirSync(folder, { recursive: true });
  const video = ["-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=${FPS}:duration=${CLIP_SECONDS}`];
  const tone = ["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${CLIP_SECONDS}`];
  const enc = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"];
  const late = path.join(folder, "late.mp4"), clean = path.join(folder, "clean.mp4");
  ffmpeg(env, [...video, "-itsoffset", String(AUDIO_DELAY), ...tone, "-map", "0:v", "-map", "1:a", ...enc, "-shortest", late]);
  ffmpeg(env, [...video, ...tone, "-map", "0:v", "-map", "1:a", ...enc, "-shortest", clean]);
  return { late, clean };
}

// audio start minus video start, in seconds, from ffprobe
export function streamGap(env, file) {
  const s = probe(env, file, "stream=codec_type,start_time").streams;
  const start = (type) => Number(s.find((x) => x.codec_type === type).start_time);
  return start("audio") - start("video");
}

function projectFor(dir, clip) {
  fs.mkdirSync(path.join(dir, "src", "footage"), { recursive: true });
  fs.copyFileSync(clip, path.join(dir, "src", "footage", "clip.mp4"));
  const project = { name: path.basename(dir), mode: "footage", aspect: "9:16", platform: "tiktok", fps: FPS, length: CLIP_SECONDS, music: "none",
    edit: { clips: [{ src: "src/footage/clip.mp4", in: 0, out: CLIP_SECONDS }], grade: "neutral", clean_voice: false },
    scenes: [{ id: "s1", start: 0, end: CLIP_SECONDS }] };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
}

export function main(argv) {
  const env = loadEnv();
  if (argv[0] === "--make") {
    if (!argv[1]) usage("give a folder", "Usage: node test/harness/late-audio-clip.mjs --make <folder>");
    const c = makeClips(env, path.resolve(argv[1]));
    line("PASS", "clips written", `${c.late} (audio starts ${streamGap(env, c.late).toFixed(3)} s after video), ${c.clean} (${streamGap(env, c.clean).toFixed(3)} s)`);
    return EXIT.PASS;
  }
  const work = tempDir("lateclip"), results = [];
  try {
    const clips = makeClips(env, path.join(work, "clips"));
    const lateGap = streamGap(env, clips.late), cleanGap = streamGap(env, clips.clean), frame = 1 / FPS;
    results.push(line(lateGap > frame && Math.abs(cleanGap) <= frame ? "PASS" : "FAIL", "fixture clips",
      `late.mp4 audio starts ${lateGap.toFixed(3)} s after video, clean.mp4 ${cleanGap.toFixed(3)} s (one frame is ${frame.toFixed(3)} s)`));
    for (const [name, clip, expectWarning] of [["late clip", clips.late, true], ["clean clip", clips.clean, false]]) {
      const dir = path.join(work, name.replace(" ", "-"));
      projectFor(dir, clip);
      const r = studio(["cut", dir]);
      const warned = WARNING_LINE(r.out);
      if (r.status !== 0) { results.push(line("FAIL", `cut on the ${name}`, `exit ${r.status}: ${r.out.trim().split("\n").slice(-3).join(" | ")}`)); continue; }
      results.push(line(warned.length > 0 === expectWarning ? "PASS" : "FAIL", `cut on the ${name}`,
        expectWarning ? (warned.length ? `warned: ${warned[0].trim()}` : "no warning printed (expected one)") : (warned.length ? `unexpected warning: ${warned[0].trim()}` : "no warning (as expected)")));
    }
  } finally {
    if (!argv.includes("--keep")) rmDir(work); else line("INFO", "kept", work);
  }
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
