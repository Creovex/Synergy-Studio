#!/usr/bin/env node
// T7 and T8: out/captions.json holds at least 90% of the transcript's words that lie inside the video's range.
// Usage: node test/harness/captions-coverage.mjs <project-dir>
// Threshold, from LITE.md section 11 (T7): "`out/captions.json` holds at least 90% of the transcript's words".
// Words are matched by normalised text (lower case, letters and digits only), in order, after the project's caption_fixes.
import fs from "node:fs";
import path from "node:path";
import { line, exitFor, requireProject, readJSON, findMp4, loadEnv, probe, isMain } from "./lib.mjs";
import { captionCoverage } from "./captions-lib.mjs";

export const MIN_COVERAGE = 0.9;

export function main(argv) {
  const dir = requireProject(argv[0]);
  const results = [];
  const captionsFile = path.join(dir, "out", "captions.json"), transcriptFile = path.join(dir, "transcript.json");
  if (!fs.existsSync(captionsFile)) return exitFor([line("FAIL", "captions.json", "out/captions.json does not exist (the page never called captions(), or render did not save the record)")]);
  if (!fs.existsSync(transcriptFile)) return exitFor([line("FAIL", "transcript.json", "transcript.json does not exist: run transcribe or words first")]);
  const project = readJSON(path.join(dir, "project.json")), transcript = readJSON(transcriptFile), captions = readJSON(captionsFile);
  let duration = null, source = "";
  const mp4 = findMp4(dir);
  if (mp4) { duration = Number(probe(loadEnv(), mp4, "format=duration").format.duration); source = `the MP4 (${duration.toFixed(2)} s)`; }
  else if (fs.existsSync(path.join(dir, "timing.json"))) { duration = readJSON(path.join(dir, "timing.json")).TOTAL; source = `timing.json (${duration} s)`; }
  else return exitFor([line("FAIL", "video range", "no MP4 in out/ and no timing.json to give the video's length")]);
  const c = captionCoverage(transcript, captions, duration, project.caption_fixes || {});
  const pct = (100 * c.ratio).toFixed(1);
  results.push(c.total === 0 ? line("FAIL", "transcript words in range", `none inside ${source}`)
    : line(c.ratio >= MIN_COVERAGE ? "PASS" : "FAIL", "captions coverage", `${c.matched} of ${c.total} transcript words in range are in out/captions.json (${pct}%, need ${MIN_COVERAGE * 100}%; range from ${source})`));
  if (c.missing.length) line("INFO", "words missing from captions.json", c.missing.slice(0, 30).join(" ") + (c.missing.length > 30 ? " ..." : ""));
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
