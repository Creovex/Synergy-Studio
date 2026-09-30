#!/usr/bin/env node
// T7 falsifier (b): the MP4 with its audio delayed 3 frames must fail the "audio against mix" line of `check` (7.9 A).
// Usage: node test/harness/delayed-mp4.mjs <project-dir> [--adelay]
// Constants, from LITE.md section 11 (T7 falsifier b): DELAY_FRAMES 3, made with ffmpeg -itsoffset (stream copy, the picture is
// untouched). `--adelay` makes the delay by re-encoding the audio with adelay instead, for the case where a decoder ignores the
// container's start offset. The delay is measured by the harness itself (decode both files, envelope correlation, tolerance 20 ms). Pass: a control copy (untouched MP4) gets PASS on "audio against mix", and the delayed copy makes
// `check` exit 2 with FAIL on that line. If `check` has no such line the result is FAIL (the check is missing).
import fs from "node:fs";
import path from "node:path";
import { line, exitFor, requireProject, readJSON, loadEnv, ffmpeg, tool, studio, tempDir, rmDir, checkCopy, parseCheck, isMain } from "./lib.mjs";
import { envelope, bestLag, WINDOW } from "./audio-lib.mjs";

export const DELAY_FRAMES = 3, CHECK_NAME = /^audio against mix/i;

export function delayAudio(env, mp4, seconds, method) {
  const out = mp4.replace(/\.mp4$/, "-delayed.mp4");
  if (method === "adelay") {
    const ms = Math.round(seconds * 1000);
    ffmpeg(env, ["-i", mp4, "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", `adelay=${ms}|${ms}`, "-c:a", "aac", "-b:a", "192k", out]);
  } else {
    ffmpeg(env, ["-i", mp4, "-itsoffset", String(seconds), "-i", mp4, "-map", "0:v", "-map", "1:a", "-c", "copy", out]);
  }
  fs.renameSync(out, mp4);
}

// the fixture is measured here, not by check: both files decoded to mono 8 kHz (a late audio start padded with silence, as a
// player would place it), envelopes in 10 ms windows, best lag over 0.5 s
export const LAG_TOLERANCE_S = 0.02, MAX_LAG_S = 0.5;
function decoded(env, file) {
  const r = tool(env.ffmpeg, ["-v", "error", "-i", file, "-vn", "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], { binary: true });
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + Math.floor(r.stdout.length / 4) * 4));
}
const measuredDelay = (env, original, delayed) => { const r = bestLag(envelope(decoded(env, original)), envelope(decoded(env, delayed)), Math.round(MAX_LAG_S * 8000 / WINDOW)); return { seconds: (r.windows * WINDOW) / 8000, correlation: r.correlation }; };

export function main(argv) {
  const dir = requireProject(argv.find((a) => !a.startsWith("--")));
  const method = argv.includes("--adelay") ? "adelay" : "itsoffset";
  const env = loadEnv(), fps = readJSON(path.join(dir, "project.json")).fps || 30, seconds = DELAY_FRAMES / fps;
  const work = tempDir("delayed"), results = [];
  try {
    const control = checkCopy(work, "control", dir), delayed = checkCopy(work, "delayed", dir);
    const original = path.join(work, "original.mp4");
    fs.copyFileSync(delayed.mp4, original);
    delayAudio(env, delayed.mp4, seconds, method);
    const m = measuredDelay(env, original, delayed.mp4);
    results.push(line(Math.abs(m.seconds - seconds) <= LAG_TOLERANCE_S ? "PASS" : "FAIL", "fixture delay",
      `the decoded audio is ${Math.round(m.seconds * 1000)} ms later than the original (asked for ${Math.round(seconds * 1000)} ms = ${DELAY_FRAMES} frames at ${fps} fps, method ${method}, correlation ${m.correlation.toFixed(3)}; tolerance ${LAG_TOLERANCE_S * 1000} ms)`));
    const c = studio(["check", control.dir]), d = studio(["check", delayed.dir]);
    const cl = parseCheck(c.out).find((x) => CHECK_NAME.test(x.name)), dl = parseCheck(d.out).find((x) => CHECK_NAME.test(x.name));
    results.push(!cl ? line("FAIL", "control copy", `check printed no "audio against mix" line (exit ${c.status}); the check is not there yet`)
      : line(cl.ok ? "PASS" : "FAIL", "control copy", `audio against mix: ${cl.ok ? "PASS" : "FAIL"} ${cl.info}`));
    if (!dl) results.push(line("FAIL", "delayed copy", `check printed no "audio against mix" line (exit ${d.status})`));
    else results.push(line(!dl.ok && d.status === 2 ? "PASS" : "FAIL", "delayed copy", `check exit ${d.status}; audio against mix: ${dl.ok ? "PASS" : "FAIL"} ${dl.info}`));
  } finally { rmDir(work); }
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
