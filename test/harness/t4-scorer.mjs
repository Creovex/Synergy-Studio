// T4 word timing accuracy: the fixed fixture and the scorer, free of any process or file access so that
// test/harness.test.mjs can prove the scorer discriminates (true timings pass, evenly spaced fake timings fail).
//
// Fixture (LITE.md section 11, T4): 20 different words synthesised one at a time with Kokoro (voice af_heart, speed 1.0),
// joined with the 19 gaps below (each 0.30 to 0.70 s). The true onset of a word is the first sample of its clip whose absolute
// value exceeds 0.01. Thresholds, fixed before the first run: median absolute onset error at most 80 ms, 95th percentile at most
// 200 ms (nearest rank: the 19th smallest of 20). A word that the transcript does not contain counts as an infinite error.
import { normaliseWord } from "./captions-lib.mjs";

export const WORDS = ["window", "garden", "planet", "silver", "market", "orange", "thunder", "bridge", "pencil", "yellow",
  "morning", "river", "candle", "mountain", "coffee", "ticket", "shadow", "forest", "letter", "harvest"];
export const GAPS = [0.45, 0.62, 0.33, 0.58, 0.70, 0.36, 0.51, 0.42, 0.66, 0.30, 0.55, 0.48, 0.39, 0.63, 0.35, 0.60, 0.44, 0.68, 0.52];
export const VOICE = "af_heart", SPEED = 1.0, ONSET_LEVEL = 0.01;
export const MAX_MEDIAN_ERROR_S = 0.080, MAX_P95_ERROR_S = 0.200;

// first sample index of a clip whose absolute value exceeds ONSET_LEVEL, or -1
export function firstOver(samples, level = ONSET_LEVEL) {
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > level) return i;
  return -1;
}

// true onsets (seconds in the joined file) from the clips' samples and the gaps between them
export function trueOnsets(clips, gaps, rate) {
  const onsets = []; let cursor = 0;
  clips.forEach((clip, i) => {
    onsets.push((cursor + firstOver(clip)) / rate);
    cursor += clip.length + (i < gaps.length ? Math.round(gaps[i] * rate) : 0);
  });
  return { onsets, duration: cursor / rate };
}

// transcript entries [{text, start}] matched to the expected words, in order (longest common subsequence on normalised text);
// returns one start per expected word, null where the word was not found
export function alignToWords(expected, entries) {
  const hyp = [];
  for (const e of entries) for (const part of String(e.text).trim().split(/\s+/)) { const token = normaliseWord(part); if (token) hyp.push({ token, start: Number(e.start) }); }
  const exp = expected.map(normaliseWord), n = exp.length, m = hyp.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = exp[i] === hyp[j].token ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const starts = new Array(n).fill(null); let i = 0, j = 0;
  while (i < n && j < m) {
    if (exp[i] === hyp[j].token) { starts[i] = hyp[j].start; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return starts;
}

export const median = (xs) => { const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
export const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * xs.length) - 1)];

// the scorer: errors per word (Infinity for a missing word), median, 95th percentile and the verdict
export function scoreOnsets(trueTimes, heardStarts) {
  const errors = trueTimes.map((t, i) => (heardStarts[i] === null || heardStarts[i] === undefined ? Infinity : Math.abs(heardStarts[i] - t)));
  const med = median(errors), p95 = percentile(errors, 0.95);
  return { errors, median: med, p95, missing: heardStarts.filter((s) => s === null || s === undefined).length,
    pass: med <= MAX_MEDIAN_ERROR_S && p95 <= MAX_P95_ERROR_S };
}

// the falsifier's fake timings: the words spread uniformly over the whole file
export const uniformTimings = (count, duration) => Array.from({ length: count }, (_, i) => (i * duration) / count);
