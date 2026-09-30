// Word onsets from the audio itself. Whisper places a word's start from its own token timing, which can sit in the silence before the
// word (up to a second early) or a few hundred milliseconds inside it. Here each start is moved to where the sound really begins:
// the first 5 ms frame above a level between the noise floor and the speech peak. Words inside continuous speech (no silence before
// them) keep Whisper's time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const RATE = 16000, FRAME_S = 0.005, FRAME = RATE * FRAME_S;
const NOISE_MARGIN_DB = 12, PEAK_DROP_DB = 35, MIN_RANGE_DB = 20, CLOSE_GAP_S = 0.08, MAX_BACK_S = 0.5, MAX_FORWARD_S = 2, MIN_WORD_GAP_S = 0.15, TAIL_S = 0.15, MIN_PAUSE_S = 0.6;

const dB = x => 20 * Math.log10(Math.max(x, 1e-5));
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

// peak level in dBFS of every 5 ms frame of a file's audio (mono 16 kHz), read in chunks
export function frameLevels(ffmpeg, file) {
  const raw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ss-levels-")), "a.f32");
  try {
    const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", raw], { encoding: "utf8" });
    if (r.status !== 0) return null;
    const fd = fs.openSync(raw, "r"), buf = Buffer.alloc(FRAME * 4 * 2000), levels = []; let carry = 0, peak = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) break;
      for (let o = 0; o + 4 <= n; o += 4) { const v = Math.abs(buf.readFloatLE(o)); if (v > peak) peak = v; if (++carry === FRAME) { levels.push(dB(peak)); carry = 0; peak = 0; } }
    }
    fs.closeSync(fd);
    return Float32Array.from(levels);
  } finally { fs.rmSync(path.dirname(raw), { recursive: true, force: true }); }
}

// runs of frames at or above the threshold, gaps shorter than CLOSE_GAP_S closed: [{a, b}] in frames (b exclusive)
export function voicedRuns(levels, threshold) {
  const runs = [], close = Math.round(CLOSE_GAP_S / FRAME_S);
  let a = -1, last = -1;
  levels.forEach((v, i) => {
    if (v < threshold) return;
    if (a >= 0 && i - last > close) { runs.push({ a, b: last + 1 }); a = -1; }
    if (a < 0) a = i;
    last = i;
  });
  if (a >= 0) runs.push({ a, b: last + 1 });
  return runs;
}

// words [{text, start, end}] with starts moved to the sound's onset where a word follows silence; same shape, new array
export function refineWords(words, levels) {
  if (!levels?.length || !words.length) return words;
  const floor = Math.max(-80, pct(levels, 0.1)), top = pct(levels, 0.95);
  if (top - floor < MIN_RANGE_DB) return words;
  const runs = voicedRuns(levels, Math.max(floor + NOISE_MARGIN_DB, top - PEAK_DROP_DB));
  const out = []; let prevStart = -Infinity;
  words.forEach((w, k) => {
    const f = Math.min(levels.length - 1, Math.max(0, Math.round(w.start / FRAME_S)));
    const inside = runs.find(r => f >= r.a && f < r.b), next = words[k + 1]?.start ?? Infinity;
    let start = w.start;
    const ahead = runs.find(r => r.a > f), aheadAt = ahead ? ahead.a * FRAME_S : Infinity;
    const lateInPrevious = inside && prevStart >= inside.a * FRAME_S - 0.02 && inside.b * FRAME_S - w.start <= TAIL_S
      && aheadAt - inside.b * FRAME_S >= MIN_PAUSE_S && w.end >= aheadAt - 0.02;   // a word placed on the last sliver of the word before it, its own sound starting after a real pause (a phrase seldom pauses 0.6 s inside a word run)
    if (inside && !lateInPrevious) {
      const cand = inside.a * FRAME_S;
      if (w.start - cand <= MAX_BACK_S && cand > prevStart + MIN_WORD_GAP_S) start = cand;
    } else if (lateInPrevious) {
      if (aheadAt - w.start <= MAX_FORWARD_S && aheadAt < next + 0.3) start = aheadAt;
    } else {
      if (aheadAt - w.start <= MAX_FORWARD_S && aheadAt < next + 0.3 && aheadAt > prevStart + MIN_WORD_GAP_S && aheadAt < w.end - 0.05) start = aheadAt;   // the word's own interval must reach the sound
    }
    const run = runs.find(r => start / FRAME_S >= r.a && start / FRAME_S < r.b);
    const end = w.end > start + 0.02 ? w.end : (run ? Math.min(run.b * FRAME_S, next) : start + 0.2);
    out.push({ ...w, start: +start.toFixed(3), end: +Math.max(end, start + 0.02).toFixed(3) });
    prevStart = start;
  });
  return out.map((w, i) => (i && out[i - 1].end > w.start ? { ...w } : w)).map((w, i, all) => (i < all.length - 1 && w.end > all[i + 1].start ? { ...w, end: all[i + 1].start } : w));
}
