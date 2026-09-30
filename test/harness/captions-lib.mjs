// Pure functions for the caption tests: word matching (T7, T8), reading and removing the page's captions() call and the
// band maths (T7). No file or process access here, so test/harness.test.mjs can run them without a render.

export const normaliseWord = (text) => String(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// compose applies caption_fixes to the transcript text with a case insensitive whole word replace; mirror that here
export function applyFixes(text, fixes = {}) {
  let t = String(text);
  for (const [from, to] of Object.entries(fixes)) t = t.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), to);
  return t;
}

// entries of transcript.json (words or phrases) as a flat list of {token, start}, phrases split on spaces
export function transcriptTokens(transcript, fixes = {}) {
  const tokens = [];
  for (const w of transcript) for (const part of applyFixes(w.text, fixes).trim().split(/\s+/)) {
    const token = normaliseWord(part);
    if (token) tokens.push({ token, text: part, start: Number(w.start) });
  }
  return tokens;
}

// the words of out/captions.json (groups of words) in order
export function captionTokens(captions) {
  const tokens = [];
  for (const group of captions) for (const w of group.words || []) { const token = normaliseWord(w.text); if (token) tokens.push({ token, text: w.text, start: Number(w.start) }); }
  return tokens;
}

// longest common subsequence of two token lists; returns the matched pairs of indices, in order
export function alignTokens(a, b) {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i].token === b[j].token ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].token === b[j].token) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

// share of the transcript words inside [0, duration] that out/captions.json holds, matched by normalised text in order
export function captionCoverage(transcript, captions, duration, fixes = {}) {
  const inRange = transcriptTokens(transcript, fixes).filter((t) => t.start >= 0 && t.start < duration);
  const held = captionTokens(captions);
  const pairs = alignTokens(inRange, held);
  const matched = new Set(pairs.map(([i]) => i));
  return { total: inRange.length, matched: matched.size, ratio: inRange.length ? matched.size / inRange.length : 0,
    missing: inRange.filter((_, i) => !matched.has(i)).map((t) => t.text) };
}

// ---------------------------------------------------------------- the page's captions() call

// comments blanked out with spaces of the same length, so indices still point into the original text
export function blankComments(html) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return html.replace(/<!--[\s\S]*?-->/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:\\])\/\/[^\n]*/gm, (m, lead) => lead + blank(m.slice(lead.length)));
}

// every real call of captions(...) in the page: [{start, end, text}] with the balanced argument list
export function findCaptionsCalls(html) {
  const code = blankComments(html), found = [], re = /(?<![\w.$])captions\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    let depth = 0, quote = null, i = open;
    for (; i < code.length; i++) {
      const c = code[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    if (depth !== 0) throw new Error("the captions( call in the page has no closing bracket");
    found.push({ start: m.index, end: i + 1, text: html.slice(m.index, i + 1) });
    re.lastIndex = i + 1;
  }
  return found;
}

// the page with every captions(...) call removed (the falsifier of T7 a and the reference still of T7)
export function stripCaptionsCalls(html) {
  const calls = findCaptionsCalls(html);
  let out = html;
  for (const c of [...calls].reverse()) out = out.slice(0, c.start) + out.slice(c.end);
  return { html: out, removed: calls.length };
}

// {top, size} of a captions call. top: a number (px), "NNpx" or "NN%"; size: a number in px (lib.js default 72)
export function readCaptionsArgs(callText) {
  const top = /\btop\s*:\s*(?:(["'`])([^"'`]*)\1|(-?[\d.]+))/.exec(callText);
  const size = /\bsize\s*:\s*(-?[\d.]+)/.exec(callText);
  return { top: top ? (top[2] !== undefined ? top[2].trim() : top[3]) : null, size: size ? Number(size[1]) : 72 };
}

// pixel rows of the band: full width, from `top` to `top + 2.5 * size`, clipped to the frame
export const BAND_SIZE_FACTOR = 2.5;
export function bandRect(top, size, frameHeight) {
  let y0;
  const t = String(top).trim();
  if (/^-?[\d.]+(px)?$/.test(t)) y0 = parseFloat(t);
  else if (/^-?[\d.]+%$/.test(t)) y0 = (parseFloat(t) / 100) * frameHeight;
  else throw new Error(`cannot read top "${top}": use a number, "NNpx" or "NN%"`);
  const y1 = y0 + BAND_SIZE_FACTOR * size;
  return { y0: Math.max(0, Math.round(y0)), y1: Math.min(frameHeight, Math.round(y1)) };
}

// mean absolute difference (0 to 255) between two raw frames (interleaved, `channels` bytes per pixel) over rows y0 to y1
export function meanAbsDiff(a, b, width, y0, y1, channels = 3) {
  if (a.length !== b.length) throw new Error(`frames differ in size (${a.length} and ${b.length} bytes)`);
  const from = y0 * width * channels, to = y1 * width * channels;
  if (!(to > from)) throw new Error("the band is empty");
  let sum = 0;
  for (let i = from; i < to; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (to - from);
}
