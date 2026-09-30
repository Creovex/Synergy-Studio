// Pure audio maths for the fixture checks: RMS envelope and the lag between two recordings of the same sound.
// The harness measures the delay it makes on its own, so that a fixture is not judged by the code under test.
export const WINDOW = 80;                         // 10 ms at 8 kHz

export function envelope(samples, window = WINDOW) {
  const out = new Float64Array(Math.floor(samples.length / window));
  for (let w = 0; w < out.length; w++) { let s = 0; for (let i = w * window; i < (w + 1) * window; i++) s += samples[i] * samples[i]; out[w] = Math.sqrt(s / window); }
  return out;
}

// how many windows later `b` is than `a` (positive: b is delayed), over lags of -maxLag to +maxLag windows, by normalised correlation
export function bestLag(a, b, maxLag) {
  let best = 0, bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0, na = 0, nb = 0;
    for (let i = Math.max(0, -lag); i < Math.min(a.length, b.length - lag); i++) { const x = a[i], y = b[i + lag]; dot += x * y; na += x * x; nb += y * y; }
    const score = na && nb ? dot / Math.sqrt(na * nb) : -Infinity;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  return { windows: best, correlation: bestScore };
}
