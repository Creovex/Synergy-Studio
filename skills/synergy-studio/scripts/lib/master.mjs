import { run } from "./common.mjs";

// Loudness that corrects itself. A single loudnorm pass followed by a limiter lands low on a peaky score, because the limiter
// takes loudness off after loudnorm has already settled its gain (a sparse film score measured -15.5 and -18.2 LUFS that way).
// Here the gain is searched with the limiter in the measured chain: apply a gain, limit, measure, and correct by the
// miss until the result is within the tolerance of the target.

export const LUFS_TARGET = -14;
export const LUFS_TOLERANCE = 0.3;       // what counts as on target
const SEARCH_TOLERANCE = 0.1;            // the search aims tighter, so the AAC encode that follows still lands inside the tolerance
export const MAX_STEPS = 4;
const MIN_SLOPE = 0.3, MAX_STEP_DB = 12;   // the search never jumps more than this many dB at once
export const REACH_TOLERANCE = 1;        // a search that ends further than this from the target did not reach it: the source is too peaky to master
export const REDUCTION_WARN_DB = 6;       // a limiter that takes more than this off the peaks is audible
const SILENT_LUFS = -69;                   // ebur128 reports about -70 for a silent file

const lastNumber = (text, re) => {
  const hits = String(text || "").match(re);
  const n = hits && hits.length ? Number(hits[hits.length - 1].match(/-?[\d.]+/)[0]) : NaN;
  return Number.isFinite(n) ? n : null;
};

// integrated loudness and true peak of what ffmpeg's ebur128 sees; null members when it printed nothing
export function parseEbur128(stderr) {
  return { I: lastNumber(stderr, /I:\s+(-?[\d.]+) LUFS/g), TP: lastNumber(stderr, /Peak:\s+(-?[\d.]+) dBFS/g) };
}

// Gain, then a 4x oversampled true-peak limiter (limit is linear: 0.70 is about -3.1 dBFS). A trim goes first in the chain:
// loudnorm shifts timestamps, so a trim after it (or an output -t) ends the sound early; the trim text ends with a comma.
export function masterChain(gain, limit, trim = "") {
  return `${trim}volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=${limit}:attack=1:release=50:level=false,aresample=48000`;
}

// how far the limiter pulls the loudest peak down, in dB (0 when it does nothing)
export function limiterReduction(peakDb, gain, limit) {
  return Math.max(0, peakDb + gain - 20 * Math.log10(limit));
}

// Pure search. `measureAt(gain)` returns the integrated loudness (LUFS) of the file after the chain with that gain.
// Returns { gain, I, steps, converged }. The best gain seen is kept, so a search that stops early still answers with its closest try.
export function searchGain(startI, measureAt, { target = LUFS_TARGET, tolerance = SEARCH_TOLERANCE, maxSteps = MAX_STEPS } = {}) {
  let gain = target - startI, best = null, prev = null, steps = 0;
  while (steps < maxSteps) {
    const I = measureAt(gain); steps++;
    if (!Number.isFinite(I)) break;
    if (!best || Math.abs(I - target) < Math.abs(best.I - target)) best = { gain, I };
    if (Math.abs(I - target) <= tolerance) break;
    // the limiter gives back part of every dB added, so the next step follows the slope seen so far (one dB of gain = 1 LU at first)
    let slope = prev && Math.abs(gain - prev.gain) > 1e-6 ? (I - prev.I) / (gain - prev.gain) : 1;
    if (!(slope >= MIN_SLOPE)) slope = 1;                                        // flat or falling: the slope says nothing, use one LU per dB
    prev = { gain, I };
    gain += Math.max(-MAX_STEP_DB, Math.min(MAX_STEP_DB, (target - I) / Math.min(1.2, slope)));
  }
  if (!best) return { gain: 0, I: startI, steps, converged: false };
  return { ...best, steps, converged: Math.abs(best.I - target) <= tolerance };
}

export function measureFile(e, file, af = "") {
  const lo = run(e.ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", (af ? af + "," : "") + "ebur128=peak=true", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  return parseEbur128(lo);
}

// The gain that puts `file` at the target after the chain. `silent: true` when there is nothing to measure.
// `reachable: false` when the limiter keeps the loudness more than REACH_TOLERANCE from the target whatever the gain: the caller stops.
// `log` receives the warnings (a heavy limiter, a search that ended off target). `trim` is the filter text that cuts to the timeline.
export function masterGain(e, file, limit, { trim = "", log = () => {} } = {}) {
  const src = measureFile(e, file, trim.replace(/,$/, ""));
  if (src.I === null || src.TP === null || src.I < SILENT_LUFS) return { silent: true, reachable: true, gain: 0, I: src.I, reduction: 0, steps: 0, converged: false };
  const found = searchGain(src.I, gain => measureFile(e, file, masterChain(gain, limit, trim)).I);
  const reduction = limiterReduction(src.TP, found.gain, limit);
  const reachable = Math.abs(found.I - LUFS_TARGET) <= REACH_TOLERANCE;
  if (reachable && reduction > REDUCTION_WARN_DB)
    log(`  ! the limiter takes ${reduction.toFixed(1)} dB off the peaks: the mix is peaky and will sound squashed. A less peaky track or softer hits fix it (in src/score.json, a lower "gain_db" on the hits or the drums).`);
  if (reachable && Math.abs(found.I - LUFS_TARGET) > LUFS_TOLERANCE)
    log(`  ! the loudness search stopped at ${found.I} LUFS (target ${LUFS_TARGET}, ${found.steps} tries): the peaks are being limited hard.`);
  return { silent: false, reachable, ...found, reduction };
}
