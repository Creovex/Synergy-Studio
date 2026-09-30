#!/usr/bin/env node
// T7: the captions must be visible. A still at a moment when a word is spoken is compared with the same still from a copy of
// the project whose page has the captions(...) call removed.
// Usage: node test/harness/caption-band.mjs <project-dir> [--t seconds] [--keep]
// Threshold, from LITE.md section 11 (T7): the mean absolute pixel difference in the caption band (full width, from the
// captions `top` to `top` plus 2.5 times the caption `size`), between a still at a spoken word and the same still with
// captions() removed, is above 10 on a 0 to 255 scale. The difference is the mean over the band's rows of all three RGB channels.
// `top` and `size` are read from the page's captions({...}) call: `top` in px or %, `size` in px (72 when absent, as lib.js does).
import fs from "node:fs";
import path from "node:path";
import { line, exitFor, usage, requireProject, readJSON, copyProject, tempDir, rmDir, studioLogged, tool, probe, loadEnv, isMain, SIZES } from "./lib.mjs";
import { findCaptionsCalls, stripCaptionsCalls, readCaptionsArgs, bandRect, meanAbsDiff } from "./captions-lib.mjs";

export const MIN_BAND_DIFFERENCE = 10;

// a time when a word is spoken: the middle of the middle word of the caption record, else of the transcript
export function spokenTime(dir) {
  const captionsFile = path.join(dir, "out", "captions.json");
  if (fs.existsSync(captionsFile)) {
    const words = readJSON(captionsFile).flatMap((g) => g.words || []);
    if (words.length) { const w = words[Math.floor(words.length / 2)]; return { t: +((w.start + w.end) / 2).toFixed(2), from: `word "${w.text}" of out/captions.json` }; }
  }
  const transcript = readJSON(path.join(dir, "transcript.json"));
  if (!transcript.length) usage("transcript.json holds no words");
  const w = transcript[Math.floor(transcript.length / 2)];
  return { t: +((w.start + w.end) / 2).toFixed(2), from: `word "${w.text}" of transcript.json` };
}

function stillOf(dir, t) {
  const r = studioLogged(["stills", dir, t]);
  const stillsDir = path.join(dir, "stills");
  const frames = r.status === 0 && fs.existsSync(stillsDir) ? fs.readdirSync(stillsDir).filter((f) => /^frame-.*\.png$/.test(f)).sort() : [];
  if (!frames.length) throw new Error(`stills produced no frame for ${dir} (exit ${r.status}): ${r.out.slice(-400)}`);
  return path.join(stillsDir, frames[0]);
}

function rawFrame(env, png) {
  const r = tool(env.ffmpeg, ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { binary: true });
  if (r.status !== 0) throw new Error(`could not decode ${png}`);
  return r.stdout;
}

export function main(argv) {
  const keep = argv.includes("--keep");
  const ti = argv.indexOf("--t");
  const positional = argv.filter((a, i) => a !== "--keep" && a !== "--t" && argv[i - 1] !== "--t");
  const dir = requireProject(positional[0]);
  const env = loadEnv(), project = readJSON(path.join(dir, "project.json"));
  const pagePath = path.join(dir, "src", "index.html");
  if (!fs.existsSync(pagePath)) usage(`${pagePath} does not exist`);
  const html = fs.readFileSync(pagePath, "utf8");
  const calls = findCaptionsCalls(html);
  if (!calls.length) return exitFor([line("FAIL", "captions call", "the page has no captions(...) call to measure")]);
  const { top, size } = readCaptionsArgs(calls[0].text);
  if (top === null) return exitFor([line("FAIL", "captions top", "the captions call has no top: option; set top (px or %) so the band can be located")]);
  const when = ti >= 0 ? { t: Number(argv[ti + 1]), from: "--t" } : spokenTime(dir);
  if (!Number.isFinite(when.t)) usage("--t needs a number of seconds");
  const [, frameH] = SIZES[project.aspect || "16:9"];
  const band = bandRect(top, size, frameH);
  const work = tempDir("band");
  const results = [];
  try {
    const withDir = copyProject(dir, path.join(work, "with")), withoutDir = copyProject(dir, path.join(work, "without"));
    fs.writeFileSync(path.join(withoutDir, "src", "index.html"), stripCaptionsCalls(html).html);
    console.log(`  still at ${when.t} s (${when.from}); band rows ${band.y0} to ${band.y1} of ${frameH} (top ${top}, size ${size})`);
    const a = stillOf(withDir, when.t), b = stillOf(withoutDir, when.t);
    const [wa, wb] = [a, b].map((f) => probe(env, f, "stream=width,height").streams[0]);
    if (wa.width !== wb.width || wa.height !== wb.height) throw new Error("the two stills differ in size");
    const diff = meanAbsDiff(rawFrame(env, a), rawFrame(env, b), wa.width, Math.min(band.y0, wa.height), Math.min(band.y1, wa.height));
    results.push(line(diff > MIN_BAND_DIFFERENCE ? "PASS" : "FAIL", "caption band difference",
      `mean absolute difference ${diff.toFixed(2)} of 255 over rows ${band.y0} to ${band.y1} (need above ${MIN_BAND_DIFFERENCE})`));
    if (keep) line("INFO", "kept", `${a} and ${b}`);
  } catch (err) {
    results.push(line("FAIL", "caption band difference", err.message));
  } finally {
    if (!keep) rmDir(work);
  }
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
