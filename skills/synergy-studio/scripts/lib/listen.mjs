import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { H, say, hf, readJSON } from "./common.mjs";
import { withHeavyLock } from "./lock.mjs";

// ---------------------------------------------------------------- listen back
// Whisper hears every spoken line again and its words are compared with the words the voice was given. A word the
// voice says wrongly comes back different ("2 a.m." came back as "2A, M.": letters with a break). Spacing and number
// style are not mistakes ("AllSpace" comes back as "all space", "two" as "2"), so a run of words that differs is
// compared again with the spaces removed and the numbers written as words.
const MODEL = "small.en", SIMILAR = 0.8;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
// an integer below one million in words ("1500" -> "one thousand five hundred"); larger numbers stay digits
export function numberWords(n) {
  if (!Number.isInteger(n) || n < 0 || n >= 1e6) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred` + (n % 100 ? ` ${numberWords(n % 100)}` : "");
  return `${numberWords(Math.floor(n / 1000))} thousand` + (n % 1000 ? ` ${numberWords(n % 1000)}` : "");
}

// Whisper writes the short form of words the voice said in full ("Dr." for the "Doctor" the voice was given)
const SHORT = [[/\bdr\./g, "doctor"], [/\bmrs\./g, "missus"], [/\bmr\./g, "mister"], [/\bms\./g, "miz"], [/\bst\./g, "saint"],
  [/\bvs\.?/g, "versus"], [/\bapprox\./g, "about"], [/\betc\./g, "and so on"], [/\be\.g\./g, "for example"], [/\bi\.e\./g, "that is"]];

// lower case words without punctuation, numbers as words, short forms in full; each keeps the index of the raw word it came from
export function tokens(words) {
  const out = [];
  words.forEach((raw, i) => {
    const plain = SHORT.reduce((s, [re, full]) => s.replace(re, ` ${full} `), String(raw).toLowerCase()).replace(/(\d),(?=\d{3})/g, "$1").replace(/%/g, " percent ").replace(/&/g, " and ").replace(/\+/g, " plus ")
      .replace(/[^a-z0-9' ]+/g, " ").replace(/'/g, "");                    // Whisper writes "90%" for "ninety percent"
    for (const part of plain.split(/\s+/).filter(Boolean)) {
      const spoken = /^\d+$/.test(part) ? numberWords(Number(part)) : part.replace(/(\d+)/g, (d) => ` ${numberWords(Number(d))} `);
      for (const t of spoken.split(/\s+/).filter(Boolean)) out.push({ t, i });
    }
  });
  return out;
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const cur = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  }
  return row[b.length];
}
export const similarity = (a, b) => (a || b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1);

// matched index pairs of two token lists (longest common subsequence), in order
function align(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i].t === b[j].t ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) { if (a[i].t === b[j].t) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return pairs;
}

// problems in what Whisper heard, as [{expected, heard, at}]: words said differently, or one word broken in two with a pause
// Splits a differing run: each expected word takes the heard pieces that spell it ("all" + "space" = "allspace"); a
// single word may also be a near miss ("organise" / "organize"). Returns [{e: [tokens], g: [tokens], ok, broken}].
function segment(e, g, hw) {
  const parts = []; let i = 0, j = 0;
  while (i < e.length && j < g.length) {
    let acc = "", k = j;
    while (k < g.length && e[i].t.startsWith(acc + g[k].t)) { acc += g[k].t; k++; }
    if (acc === e[i].t) {                                  // spelled by g[j..k)
      const raw = [...new Set(g.slice(j, k).map((x) => x.i))];
      const broken = k - j > 1 && raw.slice(0, -1).some((r) => /[,.;:!?]$/.test(hw[r]));   // "2A, M.": one word broken by a pause
      parts.push({ e: [e[i]], g: g.slice(j, k), ok: !broken, broken }); i++; j = k; continue;
    }
    let joined = "", m = j;                                // a brand heard in pieces: "LSP Dia" for "LSPedia"
    while (m < g.length && joined.length < e[i].t.length) joined += g[m++].t;
    if (similarity(e[i].t, joined) >= SIMILAR) { parts.push({ e: [e[i]], g: g.slice(j, m), ok: true, broken: false }); i++; j = m; continue; }
    parts.push({ e: e.slice(i), g: g.slice(j), ok: false, broken: false }); return parts;        // the rest differs
  }
  if (i < e.length || j < g.length) parts.push({ e: e.slice(i), g: g.slice(j), ok: false, broken: false });
  return parts;
}

export function compareHeard(expectedText, heard) {
  const exp = tokens(String(expectedText).split(/\s+/)), hw = heard.map((w) => w.text), got = tokens(hw);
  const pairs = [[-1, -1], ...align(exp, got), [exp.length, got.length]], problems = [];
  for (let k = 0; k + 1 < pairs.length; k++) {
    const [e0, g0] = pairs[k], [e1, g1] = pairs[k + 1];
    const e = exp.slice(e0 + 1, e1), g = got.slice(g0 + 1, g1);
    if (!e.length && !g.length) continue;
    for (const p of segment(e, g, hw)) {
      if (p.ok) continue;
      const raw = [...new Set(p.g.map((x) => x.i))];
      const at = raw.length ? heard[raw[0]].start : (heard[got[g0]?.i]?.end ?? 0);
      problems.push({ expected: p.e.map((x) => x.t).join(" ") || "(nothing)", heard: raw.map((r) => hw[r]).join(" ") || "(nothing)", at: Math.round(at * 100) / 100, broken: p.broken });
    }
  }
  return problems;
}

// runs Whisper on each scene's voice file and adds {heard, problems} to audio/voice-report.json; prints a line per problem
export async function listenBack(e, d, ids) {
  const reportFile = path.join(d, "audio", "voice-report.json");
  if (!fs.existsSync(reportFile)) return;
  const report = readJSON(reportFile);
  const todo = ids.filter((id) => report[id] && fs.existsSync(path.join(d, "audio", "vo", `${id}.wav`)));
  if (!todo.length) return;
  if (!e.whisper?.available) { say("listen back skipped: Whisper is not installed (studio doctor says what captions need); listen to each line yourself"); return; }
  await withHeavyLock(H, `listen back ${path.basename(d)}`, () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ss-listen-"));
    try {
      for (const id of todo) {
        const dst = path.join(scratch, id); fs.mkdirSync(dst);
        const r = hf(e, ["transcribe", path.join(d, "audio", "vo", `${id}.wav`), "-d", dst, "--json", "--engine", "whisper", "-m", MODEL], { capture: true, soft: true });
        const out = path.join(dst, "transcript.json");
        if (r.status !== 0 || !fs.existsSync(out)) { say(`  listen back ${id}: Whisper did not run (${(r.stderr || r.stdout || "").trim().split("\n").pop()})`); report[id].heard = null; continue; }
        const heard = readJSON(out).map((w) => ({ text: String(w.text).trim(), start: +w.start, end: +w.end }));
        report[id].heard = heard.map((w) => w.text).join(" ");
        report[id].heard_words = heard.map((w) => ({ text: w.text, start: Math.round(w.start * 100) / 100, end: Math.round(w.end * 100) / 100 }));   // seconds into the line
        report[id].problems = compareHeard(report[id].spoken, heard);
        for (const p of report[id].problems)
          say(`  WARNING ${id}: at ${p.at.toFixed(2)} s the voice ${p.broken ? "breaks up" : "says something else"}: expected "${p.expected}", heard "${p.heard}". Listen with studio say; fix it with a lexicon entry or by rewording`);
        if (!report[id].problems.length) say(`  ${id}: heard back as written`);
      }
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }, { log: say });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
}
