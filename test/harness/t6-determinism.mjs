#!/usr/bin/env node
// T6 determinism: the same project rendered twice gives identical decoded frames.
// Usage: node test/harness/t6-determinism.mjs [--sketch] [--hydration] [--keep]      (default: both)
// Pages: a sketch kit page (fixtures/sketch-page.html: canvas film in film mode, SS.start({cuts: "hard"}), hatching through ink,
// line boil through K.frame(t), paper grain through paperBG(), positions from K.rng(1), about 3 s, a generated src/assets/score.wav)
// and examples/hydration-tips (voice, audio, render, each run from scratch). Thresholds, from LITE.md section 11 (T6): decoded
// frames at 1 s, the middle and the last second (TOTAL minus 1 s) are identical (compared byte for byte as raw RGB).
// Falsifier: the same sketch page with K.rng(2) must differ from the K.rng(1) render at one frame or more.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { line, exitFor, loadEnv, tool, studioLogged, tempDir, rmDir, readJSON, findMp4, FIXTURES, SKILL, writeWav, isMain } from "./lib.mjs";

export const SEED = 1, FALSIFIER_SEED = 2, SKETCH_SECONDS = 3, SKETCH_FPS = 30;
export const compareTimes = (total) => [1, +(total / 2).toFixed(3), +(total - 1).toFixed(3)];

// sha256 of the decoded RGB frame at time t
export function frameHash(env, mp4, t) {
  const r = tool(env.ffmpeg, ["-v", "error", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { binary: true });
  if (r.status !== 0 || !r.stdout.length) throw new Error(`could not decode a frame of ${mp4} at ${t} s`);
  return crypto.createHash("sha256").update(r.stdout).digest("hex");
}

// project.json, generated score and the page with the given seed, then `audio`
export function makeSketchProject(dir, seed) {
  fs.mkdirSync(path.join(dir, "src", "assets"), { recursive: true });
  const rate = 24000, score = Float32Array.from({ length: rate * (SKETCH_SECONDS + 1) }, (_, i) => 0.15 * Math.sin((2 * Math.PI * 220 * i) / rate) + 0.1 * Math.sin((2 * Math.PI * 330 * i) / rate));
  writeWav(path.join(dir, "src", "assets", "score.wav"), score, rate);
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ name: "t6-sketch", mode: "film", aspect: "16:9", fps: SKETCH_FPS, length: SKETCH_SECONDS,
    music: { file: "src/assets/score.wav", start: 0, gain_db: 0 }, transition_whoosh: false, scenes: [{ id: "s1", start: 0, end: SKETCH_SECONDS }] }, null, 2));
  fs.writeFileSync(path.join(dir, "src", "index.html"), fs.readFileSync(path.join(FIXTURES, "sketch-page.html"), "utf8").replaceAll("{{SEED}}", String(seed)));
  return dir;
}

function buildAndRender(steps, dir) {
  for (const cmd of steps) { const r = studioLogged([cmd, dir]); if (r.status !== 0) throw new Error(`${cmd} failed for ${dir} (exit ${r.status}): ${r.out.trim().split("\n").slice(-3).join(" | ")}`); }
  const mp4 = findMp4(dir);
  if (!mp4) throw new Error(`render wrote no MP4 in ${dir}`);
  return mp4;
}

const hashesOf = (env, mp4, times) => times.map((t) => frameHash(env, mp4, t));
const show = (label, times, hashes) => times.forEach((t, i) => console.log(`  ${label} t=${t} s  sha256 ${hashes[i].slice(0, 16)}`));

function compare(name, env, a, b, times, results) {
  const ha = hashesOf(env, a, times), hb = hashesOf(env, b, times);
  show("first ", times, ha); show("second", times, hb);
  const same = times.map((_, i) => ha[i] === hb[i]);
  results.push(line(same.every(Boolean) ? "PASS" : "FAIL", name, `frames at ${times.join(", ")} s: ${same.map((s) => (s ? "identical" : "DIFFERENT")).join(", ")}`));
  return ha;
}

export function main(argv) {
  const env = loadEnv(), only = (k) => !argv.includes("--sketch") && !argv.includes("--hydration") || argv.includes(k);
  const work = tempDir("t6"), results = [];
  try {
    if (only("--sketch")) {
      const dirs = { a: makeSketchProject(path.join(work, "sketch-a"), SEED), b: makeSketchProject(path.join(work, "sketch-b"), SEED), f: makeSketchProject(path.join(work, "sketch-rng2"), FALSIFIER_SEED) };
      const mp4 = Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, buildAndRender(["audio", "render"], d)]));
      const total = readJSON(path.join(dirs.a, "timing.json")).TOTAL, times = compareTimes(total);
      const first = compare("sketch page rendered twice (rng 1)", env, mp4.a, mp4.b, times, results);
      const other = hashesOf(env, mp4.f, times);
      show("rng(2)", times, other);
      const differs = times.map((_, i) => first[i] !== other[i]);
      results.push(line(differs.some(Boolean) ? "PASS" : "FAIL", "falsifier: the sketch page with rng 2", `${differs.filter(Boolean).length} of ${times.length} frames differ from the rng 1 render (at least 1 required)`));
    }
    if (only("--hydration")) {
      const example = path.join(SKILL, "examples", "hydration-tips"), dirs = ["a", "b"].map((k) => path.join(work, `hydration-${k}`));
      dirs.forEach((d) => fs.cpSync(example, d, { recursive: true }));
      const mp4 = dirs.map((d) => buildAndRender(["voice", "audio", "render"], d));
      compare("hydration-tips rendered twice", env, mp4[0], mp4[1], compareTimes(readJSON(path.join(dirs[0], "timing.json")).TOTAL), results);
    }
  } catch (err) {
    results.push(line("FAIL", "t6", err.message));
  } finally {
    if (argv.includes("--keep")) line("INFO", "kept", work); else rmDir(work);
  }
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
