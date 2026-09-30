// T0 skill contract, the text side: what SKILL.md, references/*.md and the examples name. Pure functions (no file or process
// access) so test/harness.test.mjs can run them on a small sample text.
//
// What is extracted (LITE.md section 11, T0):
//   commands  every `studio <command>` inside a code span, a fenced block or a table row of a Command table
//   flags     every --flag in the same code span, fenced line or Command table row as its command
//   files     every file name the text says a command writes: in the Writes column of a Command table; after a verb such as
//             "writes" or an arrow, in the same sentence as the command; or a bare file name in brackets right after the command
//   helpers   every name destructured from SS.start(), every code span in a sentence that names SS.start( or "helpers", and a span before "in lib.js"
//   sketch    every name destructured from the sketch kit object K, and the first column of a table headed Function
//   tools     every studio_<name> (used by the --tools mode)

export const FILE_EXT = "json|jpg|jpeg|png|wav|mp3|mp4|js|mjs|html|md|css|srt|vtt|txt";
const FILE_TOKEN = new RegExp(`^[\\w./<>*$-]+\\.(?:${FILE_EXT})$`);
export const isFileToken = (s) => FILE_TOKEN.test(s) && !/[$…]/.test(s);
// words that look like helper names but name a parameter or a value, never a lib.js export
export const NOT_HELPERS = new Set(["opts"]);

const MENTION = /\bstudio(?:\.mjs)?\s+([a-z][a-z-]*)\b/g;
const FLAG = /(?<![\w-])--([a-z][a-z0-9-]*)/g;
const WRITE_MARKER = /\b(?:writes|wrote|makes|produces|creates|saves|outputs|generates|gives)\b|→|->/i;

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const stripMarks = (s) => s.replace(/\*\*/g, "");

// segments of a paragraph: [{code, text, index}] split at backtick spans
export function segments(paragraph) {
  const out = []; const re = /`([^`]+)`/g; let last = 0, m;
  while ((m = re.exec(paragraph))) {
    if (m.index > last) out.push({ code: false, text: paragraph.slice(last, m.index), index: last });
    out.push({ code: true, text: m[1], index: m.index });
    last = m.index + m[0].length;
  }
  if (last < paragraph.length) out.push({ code: false, text: paragraph.slice(last), index: last });
  return out;
}

// mentions of `studio <command>` in a piece of code: [{name, flags}] (flags up to the next mention)
export function mentionsIn(code) {
  const found = [...code.matchAll(MENTION)];
  return found.map((m, i) => {
    const seg = code.slice(m.index + m[0].length, i + 1 < found.length ? found[i + 1].index : code.length);
    return { name: m[1], flags: [...seg.matchAll(FLAG)].map((f) => f[1]) };
  });
}

const splitRow = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());

// blocks of the markdown text: fences, tables and paragraphs, each with the line it starts on
export function blocks(text) {
  const lines = text.split("\n"), out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      const start = i + 1; i++;
      const body = []; while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      out.push({ kind: "fence", line: start + 1, lines: body }); i++; continue;
    }
    if (/^\s*\|/.test(l)) {
      const start = i, rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      out.push({ kind: "table", line: start + 1, rows }); continue;
    }
    if (!l.trim()) { i++; continue; }
    const start = i, para = []; while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^\s*\|/.test(lines[i])) para.push(lines[i++]);
    out.push({ kind: "para", line: start + 1, text: para.join("\n") });
  }
  return out;
}

// the first sentence-end (a full stop followed by space or the end), ignoring "e.g." and "i.e."
function sentenceEnd(text) {
  const masked = text.replace(/\b(e\.g|i\.e)\./g, (m) => "x".repeat(m.length));
  const m = /\.(?:\s|$)/.exec(masked);
  return m ? m.index + 1 : -1;
}

// commands, flags and written files named in one paragraph (also used for a table cell)
function inlineFacts(paragraph, where, facts) {
  const segs = segments(paragraph);
  segs.forEach((seg, i) => {
    if (!seg.code) return;
    for (const men of mentionsIn(seg.text)) facts.commands.push({ name: men.name, flags: men.flags, ...where(seg.index), via: "code" });
    const own = mentionsIn(seg.text); if (!own.length) return;
    const cmd = own[own.length - 1].name;
    // files this command writes: a bare file name in brackets straight after it, or files after a verb or arrow in the same sentence
    const next = segs[i + 1];
    const bracket = next && !next.code ? /^\s*\(\s*([^()]*?)\s*\)/.exec(next.text) : null;
    if (bracket) for (const t of bracket[1].split(/\s*,\s*/)) if (isFileToken(t)) facts.files.push({ cmd, path: t, ...where(seg.index), via: "brackets" });
    let armed = false;
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[j];
      if (s.code) {
        if (mentionsIn(s.text).length) break;
        if (armed && isFileToken(s.text)) facts.files.push({ cmd, path: s.text, ...where(s.index), via: "sentence" });
        continue;
      }
      const txt = stripMarks(s.text), end = sentenceEnd(txt), head = end >= 0 ? txt.slice(0, end) : txt;
      if (WRITE_MARKER.test(head)) armed = true;
      if (end >= 0) break;
    }
  });
}

function helperNames(spanText) {
  const t = spanText.trim(), call = /^([A-Za-z_]\w*)\(.*\)$/.exec(t);
  if (call) return [call[1]];
  if (/^[A-Za-z_]\w*(?:\s+[A-Za-z_]\w*)*$/.test(t)) return t.split(/\s+/);
  return [];
}

// sentences of a paragraph that name SS.start( or the word "helpers": the code spans in them are helper names
function helperFacts(paragraph, where, facts) {
  const masked = paragraph.replace(/\b(e\.g|i\.e)\./g, (m) => "x".repeat(m.length));
  const bounds = [-1]; for (const m of masked.matchAll(/\.(?=\s|$)/g)) bounds.push(m.index);
  bounds.push(paragraph.length);
  for (let k = 0; k + 1 < bounds.length; k++) {
    const from = bounds[k] + 1, to = Math.max(from, bounds[k + 1]), sentence = paragraph.slice(from, to);
    if (/SS\.start\(|\bhelpers\b/i.test(sentence))
      for (const seg of segments(sentence)) if (seg.code) for (const name of helperNames(seg.text)) if (!NOT_HELPERS.has(name)) facts.helpers.push({ name, ...where(from + seg.index), via: "sentence" });
    // "`count()` in lib.js": the span just before "in lib.js" names a helper
    for (const m of sentence.matchAll(/`([^`]+)`\s+(?:in|from|of)\s+`?lib\.js`?/g))
      for (const name of helperNames(m[1])) if (!NOT_HELPERS.has(name)) facts.helpers.push({ name, ...where(from + m.index), via: "in lib.js" });
  }
}

// every fact one file's text states
export function parseText(file, text) {
  const facts = { commands: [], files: [], helpers: [], sketch: [], tools: [] };
  let m;
  for (m of text.matchAll(/\bstudio_[a-z][a-z0-9_]*\b/g)) facts.tools.push({ name: m[0], file, line: lineOf(text, m.index) });
  for (m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*SS\.start\s*\(/g))
    for (const part of m[1].split(",")) { const name = part.split(":")[0].trim(); if (/^[A-Za-z_]\w*$/.test(name)) facts.helpers.push({ name, file, line: lineOf(text, m.index), via: "destructured" }); }
  for (m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*K\s*;/g))
    for (const part of m[1].split(",")) { const name = part.split(":")[0].trim(); if (/^[A-Za-z_]\w*$/.test(name)) facts.sketch.push({ name, file, line: lineOf(text, m.index), via: "destructured" }); }
  for (const b of blocks(text)) {
    const at = (line) => () => ({ file, line });
    if (b.kind === "fence") {
      b.lines.forEach((l, k) => { for (const men of mentionsIn(l)) facts.commands.push({ name: men.name, flags: men.flags, file, line: b.line + k, via: "fence" }); });
    } else if (b.kind === "para") {
      inlineFacts(b.text, (off) => ({ file, line: b.line + b.text.slice(0, off).split("\n").length - 1 }), facts);
      helperFacts(b.text, (off) => ({ file, line: b.line + b.text.slice(0, off).split("\n").length - 1 }), facts);
    } else {
      const header = splitRow(b.rows[0]).map((c) => c.replace(/`/g, "").trim().toLowerCase());
      const writesCol = header.indexOf("writes");
      b.rows.forEach((row, k) => {
        if (k < 2) return;
        const cells = splitRow(row), line = b.line + k;
        if (header[0] === "command") {
          const name = (/`([^`]+)`/.exec(cells[0]) || [])[1];
          if (name && /^[a-z][a-z-]*$/.test(name.trim())) {
            const flags = [...cells.slice(1).join(" ").matchAll(FLAG)].map((f) => f[1]);
            facts.commands.push({ name: name.trim(), flags, file, line, via: "table" });
            if (writesCol > 0 && cells[writesCol]) for (const s of segments(cells[writesCol])) if (s.code && isFileToken(s.text.trim())) facts.files.push({ cmd: name.trim(), path: s.text.trim(), file, line, via: "writes column" });
            return;
          }
        }
        if (header[0] === "function") for (const s of segments(cells[0] || "")) if (s.code) {
          const t = s.text.trim(), call = /^(?:K\.)?([A-Za-z_]\w*)\s*(?:\(.*\))?$/.exec(t);
          if (call) facts.sketch.push({ name: call[1], file, line, via: "function table" });
        }
        cells.forEach((cell) => { inlineFacts(cell, at(line), facts); });
      });
    }
  }
  return facts;
}

// facts of several files, each item once with every place that names it
export function collect(files) {
  const all = { commands: [], files: [], helpers: [], sketch: [], tools: [] };
  for (const f of files) { const p = parseText(f.file, f.text); for (const k of Object.keys(all)) all[k].push(...p[k]); }
  return all;
}

export function unique(items, keyOf) {
  const map = new Map();
  for (const it of items) { const k = keyOf(it); if (!map.has(k)) map.set(k, { ...it, where: [] }); map.get(k).where.push(`${it.file}:${it.line}`); }
  return [...map.values()];
}
