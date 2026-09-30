#!/usr/bin/env node
// T10 falsifier: the same MP4 converted to 30 fps with ffmpeg (audio kept) makes `check` exit 2 on the frame rate line.
// Usage: node test/harness/fps30-conversion.mjs <project-dir>
// Constant, from LITE.md section 11 (T10): TARGET_FPS 30. The project must be a 60 fps project (its own `fps` is not 30),
// otherwise the conversion changes nothing and the script stops with a usage error. Pass: a control copy gets PASS on
// "frame rate", the converted copy makes `check` exit 2 with FAIL on that line.
import fs from "node:fs";
import path from "node:path";
import { line, exitFor, usage, requireProject, readJSON, loadEnv, ffmpeg, probe, studio, tempDir, rmDir, checkCopy, parseCheck, isMain } from "./lib.mjs";

export const TARGET_FPS = 30, CHECK_NAME = /^frame rate/i;

const rateOf = (env, file) => { const [n, d] = probe(env, file, "stream=codec_type,r_frame_rate").streams.find((s) => s.codec_type === "video").r_frame_rate.split("/").map(Number); return n / (d || 1); };

export function main(argv) {
  const dir = requireProject(argv[0]);
  const env = loadEnv(), fps = readJSON(path.join(dir, "project.json")).fps || 30;
  if (fps === TARGET_FPS) usage(`the project's fps is already ${TARGET_FPS}: give the 60 fps project (T10)`);
  const work = tempDir("fps30"), results = [];
  try {
    const control = checkCopy(work, "control", dir), converted = checkCopy(work, "converted", dir);
    const tmp = converted.mp4.replace(/\.mp4$/, "-30.mp4");
    ffmpeg(env, ["-i", converted.mp4, "-map", "0:v", "-map", "0:a", "-vf", `fps=${TARGET_FPS}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-c:a", "copy", "-movflags", "+faststart", tmp]);
    fs.renameSync(tmp, converted.mp4);
    const [was, now] = [rateOf(env, control.mp4), rateOf(env, converted.mp4)];
    results.push(line(Math.abs(now - TARGET_FPS) < 0.01 && Math.abs(was - fps) < 0.01 ? "PASS" : "FAIL", "fixture", `original ${was} fps, converted copy ${now} fps`));
    const c = studio(["check", control.dir]), d = studio(["check", converted.dir]);
    const cl = parseCheck(c.out).find((x) => CHECK_NAME.test(x.name)), dl = parseCheck(d.out).find((x) => CHECK_NAME.test(x.name));
    results.push(!cl ? line("FAIL", "control copy", `check printed no "frame rate" line (exit ${c.status}); the check is not there yet`)
      : line(cl.ok ? "PASS" : "FAIL", "control copy", `frame rate: ${cl.ok ? "PASS" : "FAIL"} ${cl.info}`));
    if (!dl) results.push(line("FAIL", "converted copy", `check printed no "frame rate" line (exit ${d.status})`));
    else results.push(line(!dl.ok && d.status === 2 ? "PASS" : "FAIL", "converted copy", `check exit ${d.status}; frame rate: ${dl.ok ? "PASS" : "FAIL"} ${dl.info}`));
  } finally { rmDir(work); }
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
