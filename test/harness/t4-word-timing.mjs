#!/usr/bin/env node
// T4 word timing accuracy of `transcribe` (see t4-scorer.mjs for the fixture and the thresholds).
// Usage: node test/harness/t4-word-timing.mjs [--keep]
// Prints PASS or FAIL lines and exits 0 or 2. If `transcribe` cannot run because Whisper is not downloaded, prints PENDING with
// the reason and exits 3. The falsifier (evenly spaced fake timings scored by the same scorer) needs only the synthesis and
// runs first: it must FAIL the scorer, and a FAIL line is printed if it passes.
import fs from "node:fs";
import path from "node:path";
import { line, exitFor, loadEnv, tool, studioLogged, tempDir, rmDir, readJSON, toolHome, isMain, HARNESS } from "./lib.mjs";
import { WORDS, GAPS, VOICE, SPEED, ONSET_LEVEL, MAX_MEDIAN_ERROR_S, MAX_P95_ERROR_S, alignToWords, scoreOnsets, uniformTimings } from "./t4-scorer.mjs";

// output of `transcribe` (or a tool home without whisper) that means the model or the network is missing rather than that the command is wrong
export const UNAVAILABLE = /unavailable|not downloaded|could not download|\b403\b|ENOTFOUND|EAI_AGAIN|offline|whisper-cli.*(not found|missing)|no whisper/i;
const ms = (s) => (Number.isFinite(s) ? `${Math.round(s * 1000)} ms` : "missing");

export function main(argv) {
  const env = loadEnv(), work = tempDir("t4"), results = [];
  try {
    const spec = path.join(work, "spec.json"), wav = path.join(work, "joined.wav"), truthFile = path.join(work, "truth.json");
    fs.writeFileSync(spec, JSON.stringify({ words: WORDS, gaps: GAPS, voice: VOICE, speed: SPEED, onset_level: ONSET_LEVEL }));
    const s = tool(env.python, [path.join(HARNESS, "t4_synth.py"), path.join(toolHome(), "env.json"), spec, wav, truthFile]);
    if (s.status !== 0) return exitFor([line("FAIL", "fixture synthesis", `Kokoro synthesis failed: ${String(s.stderr).slice(-400)}`)]);
    const truth = readJSON(truthFile);
    line("INFO", "fixture", `${WORDS.length} words, ${truth.duration.toFixed(2)} s, first onsets ${truth.onsets.slice(0, 4).map((t) => t.toFixed(3)).join(", ")} s`);
    // falsifier first: evenly spaced fake timings must fail the scorer
    const fake = scoreOnsets(truth.onsets, uniformTimings(WORDS.length, truth.duration));
    results.push(line(fake.pass ? "FAIL" : "PASS", "falsifier: evenly spaced timings",
      `median error ${ms(fake.median)}, 95th percentile ${ms(fake.p95)}: the scorer ${fake.pass ? "ACCEPTED them (it cannot tell timings apart)" : "rejects them, as required"}`));
    // the real run
    const proj = path.join(work, "proj");
    fs.mkdirSync(proj);
    fs.writeFileSync(path.join(proj, "project.json"), JSON.stringify({ name: "t4", mode: "footage", aspect: "9:16", fps: 30 }));
    const r = studioLogged(["transcribe", proj, wav]);
    const transcriptFile = path.join(proj, "transcript.json");
    if (r.status !== 0 || !fs.existsSync(transcriptFile)) {
      const reason = r.out.trim().split("\n").slice(-4).join(" | ");
      results.push(env.whisper?.available === false || UNAVAILABLE.test(r.out) ? line("PENDING", "transcribe", `unavailable: ${reason}`) : line("FAIL", "transcribe", `exit ${r.status}: ${reason}`));
      return exitFor(results);
    }
    const heard = alignToWords(WORDS, readJSON(transcriptFile));
    const score = scoreOnsets(truth.onsets, heard);
    WORDS.forEach((w, i) => console.log(`  ${w.padEnd(9)} true ${truth.onsets[i].toFixed(3)} s   heard ${heard[i] === null ? "missing" : Number(heard[i]).toFixed(3) + " s"}   error ${ms(score.errors[i])}`));
    results.push(line(score.median <= MAX_MEDIAN_ERROR_S ? "PASS" : "FAIL", "median onset error", `${ms(score.median)} (need at most ${ms(MAX_MEDIAN_ERROR_S)})`));
    results.push(line(score.p95 <= MAX_P95_ERROR_S ? "PASS" : "FAIL", "95th percentile onset error", `${ms(score.p95)} (need at most ${ms(MAX_P95_ERROR_S)}); ${score.missing} word(s) missing`));
  } finally {
    if (argv.includes("--keep")) line("INFO", "kept", work); else rmDir(work);
  }
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
