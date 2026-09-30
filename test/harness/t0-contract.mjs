#!/usr/bin/env node
// T0 skill contract: everything the skill text names must exist in the repository's code.
// Usage: node test/harness/t0-contract.mjs [skill-folder] [--repo <skill-folder-of-the-code>] [--run] [--tools <tools-list.json>] [--falsifier]
//   skill-folder  the text to check: SKILL.md, references/*.md, examples (default reference/lite-branch/skills/synergy-studio,
//                 the owner's text at commit 30127c8)
//   --repo        the code to prove it against (default skills/synergy-studio of this repository)
//   --run         also produce the files of the cheap commands (new, say, silences, scenes, reference, frames, beats) with a real
//                 run and look for the file the text names, instead of only searching the command's code
//   --tools file  after the tool sweep: check every studio_<name> the text names against a tools/list answer (a JSON file that
//                 is {tools: [{name}]}, {result: {tools: [...]}} or a plain array of names or objects); commands, flags and file
//                 names are then not checked (the text no longer names CLI commands), leftover `studio <command>` mentions are WARN
//   --falsifier   add the line "run `studio fly <dir>`" to a copy of SKILL.md and require the check to fail on `fly`
// Prints one line per item (PASS or FAIL, kind, item, evidence, where the text names it) and exits 0, or 2 on any FAIL.
// Rules for what counts as an item are in t0-parse.mjs; how each kind is proven:
//   command  it is listed by `studio.mjs help` (and has a module in scripts/lib)
//   flag     it appears in that command's usage: its section of the help text or the USAGE line of its module
//   file     the command's module (and the modules and Python scripts it uses) names the file, or with --run the file appears
//   helper   it is a key of the object returned by SS.start(), found by evaluating template/lib.js with a stub gsap and page
//   sketch   it is a key of SK.create(canvas) or SK, found by evaluating template/sketch.js with a stub canvas
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { EXIT, REPO, tempDir, rmDir, studio, ffmpeg, loadEnv, isMain, usage } from "./lib.mjs";
import { collect, unique } from "./t0-parse.mjs";

export const DEFAULT_TEXT = path.join(REPO, "reference", "lite-branch", "skills", "synergy-studio");
export const DEFAULT_CODE = path.join(REPO, "skills", "synergy-studio");
const INFRA_MODULES = new Set(["common.mjs", "env.mjs", "lock.mjs", "paths.mjs", "run.mjs"]);   // shared plumbing, not a command's own code

// ---------------------------------------------------------------- the text

export function readSkillFiles(folder) {
  const files = [], add = (rel) => { const p = path.join(folder, rel); if (fs.existsSync(p)) files.push({ file: rel, text: fs.readFileSync(p, "utf8") }); };
  add("SKILL.md");
  const refs = path.join(folder, "references");
  if (fs.existsSync(refs)) for (const f of fs.readdirSync(refs).sort()) if (f.endsWith(".md")) add(`references/${f}`);
  const ex = path.join(folder, "examples");
  if (fs.existsSync(ex)) {
    add("examples/README.md");
    for (const d of fs.readdirSync(ex).sort()) for (const rel of ["project.json", "src/index.html"]) add(`examples/${d}/${rel}`);
  }
  if (!files.some((f) => f.file === "SKILL.md")) throw new Error(`${folder} has no SKILL.md`);
  return files;
}

// ---------------------------------------------------------------- the code

// commands listed by `studio.mjs help`, and each one's section of that text
export function helpSections(helpText) {
  const sections = new Map(); let current = null;
  for (const l of helpText.split("\n")) {
    const m = /^ {2}([a-z][a-z-]*)\b/.exec(l);
    if (m) { current = m[1]; sections.set(current, l); }
    else if (current && /^ {4,}\S/.test(l)) sections.set(current, sections.get(current) + "\n" + l);
    else current = null;
  }
  return sections;
}

// the module of a command and what it imports (without shared plumbing), plus the Python scripts they name
export function commandSources(codeDir, cmd) {
  const lib = path.join(codeDir, "scripts", "lib"), first = path.join(lib, `${cmd}.mjs`);
  if (!fs.existsSync(first)) return null;
  const seen = new Set(), queue = [first], sources = [];
  while (queue.length) {
    const f = queue.shift(); if (seen.has(f)) continue; seen.add(f);
    const text = fs.readFileSync(f, "utf8"); sources.push({ file: path.relative(codeDir, f), text });
    for (const m of text.matchAll(/from\s+["']\.\/([\w-]+\.mjs)["']/g)) { const p = path.join(lib, m[1]); if (!INFRA_MODULES.has(m[1]) && fs.existsSync(p)) queue.push(p); }
    for (const m of text.matchAll(/["']([\w-]+\.py)["']/g)) { const p = path.join(codeDir, "scripts", m[1]); if (fs.existsSync(p)) queue.push(p); }
  }
  return sources;
}

const usageLine = (source) => (/export const USAGE\s*=\s*(["'`])([\s\S]*?)\1\s*;/.exec(source) || [])[2] || "";

// does the code mention a file name such as stills/sheet.jpg or audio/vo/<id>.wav (placeholders match anything)
export function mentionsFile(sources, filePath) {
  const parts = filePath.split("/"), base = parts.pop();
  const chunks = base.split(/<[^>]*>|\*/).filter(Boolean), dir = parts.filter((p) => !/[<*]/.test(p)).slice(-1);
  return sources.some((s) => [...chunks, ...dir].every((c) => s.text.includes(c)));
}

// evaluates a browser script in a stub page and returns what `pick` extracts from the sandbox
function evaluate(file, sandbox, pick) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { timeout: 5000, filename: file });
  return pick(sandbox);
}
const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain(), set: () => true });

export function libKeys(codeDir) {
  const window = { TIMING: { T: { s1: { start: 0, vo: 0.5, vo_end: 1.5, end: 2, dur: 2 } }, EV: {}, TOTAL: 2, fps: 30 } };
  const gsap = { timeline: () => chain(), set() {}, to() {} };
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => chain() };
  return evaluate(path.join(codeDir, "template", "lib.js"), { window, gsap, document }, (s) => Object.keys(s.window.SS.start()));
}

export function sketchKeys(codeDir) {
  const canvas = () => ({ width: 100, height: 100, getContext: () => chain() });
  const window = {}, document = { createElement: () => canvas() };
  return evaluate(path.join(codeDir, "template", "sketch.js"), { window, document, DOMMatrix: class {} },
    (s) => [...Object.getOwnPropertyNames(s.window.SK.create(canvas())), ...Object.keys(s.window.SK)]);
}

// ---------------------------------------------------------------- real runs of the cheap commands

const walk = (dir, base = dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]) : [];
const asRegex = (p) => new RegExp("^" + p.split(/(<[^>]*>|\*)/).map((c, i) => (i % 2 ? "[^/]*" : c.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))).join("") + "$");

// runs new, say, silences, scenes, reference, frames and beats on generated inputs; returns {ran: Map cmd -> {ok, note}, tree: Set of relative files}
export function realRuns(log) {
  const env = loadEnv(), work = tempDir("t0"), ran = new Map(), tree = new Set();
  const attempt = (cmd, args) => { const r = studio([cmd, ...args]); ran.set(cmd, { ok: r.status === 0, note: r.status === 0 ? "" : `exit ${r.status}: ${r.out.trim().split("\n").slice(-2).join(" | ")}` }); log(`  run ${cmd}: exit ${r.status}`); return r; };
  try {
    const clip = path.join(work, "clip.mp4"), song = path.join(work, "song.wav"), a = path.join(work, "footage"), b = path.join(work, "narrated");
    ffmpeg(env, ["-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=3", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=30:d=3", "-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*440*t)*lt(mod(t\\,2)\\,1):s=48000:d=6",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clip]);
    ffmpeg(env, ["-f", "lavfi", "-i", "aevalsrc=0.8*sin(2*PI*1000*t)*lt(mod(t\\,0.5)\\,0.03):s=44100:d=10", song]);
    attempt("new", [a, "--mode", "footage", "--aspect", "9:16", "--platform", "tiktok", "--length", "10"]);
    const newNarrated = studio(["new", b]); log(`  run new (narrated): exit ${newNarrated.status}`);
    attempt("say", [b, "hello there"]); attempt("silences", [a, clip]); attempt("scenes", [a, clip]);
    attempt("reference", [a, clip]); attempt("frames", [clip, "--out", path.join(work, "frames.jpg")]); attempt("beats", [a, song]);
    for (const f of [...walk(a), ...walk(b)]) tree.add(f);
  } catch (err) { log(`  real runs stopped: ${err.message}`); ran.set("__error", { ok: false, note: err.message }); }
  finally { rmDir(work); }
  return { ran, tree };
}

// ---------------------------------------------------------------- the checks

const FLY_LINE = "\nrun `studio fly <dir>`\n";

// items: [{status, kind, item, evidence, where}] for the text in `textDir` against the code in `codeDir`
export function analyze({ textDir, codeDir, toolsFile = null, run = false, log = () => {} }) {
  const facts = collect(readSkillFiles(textDir)), items = [];
  const push = (status, kind, item, evidence, where) => { const at = [...new Set(where)]; items.push({ status, kind, item, evidence, where: at.length > 2 ? `${at.slice(0, 2).join(", ")} +${at.length - 2}` : at.join(", ") }); };
  const toolNames = toolsFile ? new Set(toolList(JSON.parse(fs.readFileSync(toolsFile, "utf8")))) : null;

  if (toolNames) {
    for (const t of unique(facts.tools, (x) => x.name)) push(toolNames.has(t.name) ? "PASS" : "FAIL", "tool", t.name, toolNames.has(t.name) ? "in tools/list" : `not in tools/list (${toolNames.size} tools listed)`, t.where);
    for (const c of unique(facts.commands, (x) => x.name)) push("WARN", "command", `studio ${c.name}`, "the text still names a CLI command after the tool sweep", c.where);
  } else {
    const help = helpText(codeDir), sections = helpSections(help), known = new Set([...sections.keys(), "help"]);
    const runs = run ? realRuns(log) : null, tree = runs ? [...runs.tree] : [];
    for (const c of unique(facts.commands, (x) => x.name)) {
      const src = commandSources(codeDir, c.name);
      push(known.has(c.name) ? "PASS" : "FAIL", "command", `studio ${c.name}`, known.has(c.name) ? `listed by studio.mjs help${src ? `; module ${src[0].file}` : ""}` : "not listed by studio.mjs help", c.where);
    }
    const flagItems = unique(facts.commands.flatMap((c) => c.flags.map((f) => ({ ...c, flag: f }))), (x) => `${x.name} --${x.flag}`);
    for (const f of flagItems) {
      if (!known.has(f.name)) { push("FAIL", "flag", `${f.name} --${f.flag}`, "the command is not listed by studio.mjs help", f.where); continue; }
      const src = commandSources(codeDir, f.name), usageText = `${sections.get(f.name) || ""}\n${src ? usageLine(src[0].text) : ""}`;
      const shown = new RegExp(`(?<![\\w-])--${f.flag}(?![\\w-])`).test(usageText);
      push(shown ? "PASS" : "FAIL", "flag", `${f.name} --${f.flag}`, shown ? "shown in the command's usage" : "not in the command's usage text (help section or USAGE line)", f.where);
    }
    for (const f of unique(facts.files, (x) => `${x.cmd} ${x.path}`)) {
      if (!known.has(f.cmd)) { push("FAIL", "file", `${f.cmd} writes ${f.path}`, "the command is not listed by studio.mjs help", f.where); continue; }
      const r = runs && runs.ran.get(f.cmd);
      if (r && r.ok) {
        const re = asRegex(f.path), hit = tree.find((t) => re.test(t));
        push(hit ? "PASS" : "FAIL", "file", `${f.cmd} writes ${f.path}`, hit ? `real run produced ${hit}` : "the real run did not produce it", f.where);
        continue;
      }
      const src = commandSources(codeDir, f.cmd);
      if (!src) { push("FAIL", "file", `${f.cmd} writes ${f.path}`, `no module scripts/lib/${f.cmd}.mjs`, f.where); continue; }
      const named = src.filter((s) => mentionsFile([s], f.path)), ok = named.length > 0;
      push(ok ? "PASS" : "FAIL", "file", `${f.cmd} writes ${f.path}`, (r ? `real run failed (${r.note}); ` : "") + (ok ? `named in ${named.map((s) => path.basename(s.file)).join(", ")}` : `not named in ${src.map((s) => path.basename(s.file)).join(", ")}`), f.where);
    }
  }
  const lk = new Set(libKeys(codeDir)), sk = new Set(sketchKeys(codeDir));
  for (const h of unique(facts.helpers, (x) => x.name)) push(lk.has(h.name) ? "PASS" : "FAIL", "helper", h.name, lk.has(h.name) ? "returned by SS.start()" : `not returned by SS.start() (keys: ${[...lk].join(" ")})`, h.where);
  for (const h of unique(facts.sketch, (x) => x.name)) push(sk.has(h.name) ? "PASS" : "FAIL", "sketch", h.name, sk.has(h.name) ? "on the sketch kit object" : "not on the sketch kit object", h.where);
  return items;
}

// a tools/list answer in any of the usual shapes, as a list of names
export function toolList(json) {
  const list = Array.isArray(json) ? json : json.tools || json.result?.tools;
  if (!Array.isArray(list)) throw new Error("the tools file must be {tools: [...]}, {result: {tools: [...]}} or an array");
  return list.map((t) => (typeof t === "string" ? t : t.name));
}

// the help text of the code under test, read through its own dispatcher
function helpText(codeDir) {
  const r = spawnSync(process.execPath, [path.join(codeDir, "scripts", "studio.mjs"), "help"], { encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "");
}

// ---------------------------------------------------------------- main

const cell = (s, n) => (s.length > n ? s.slice(0, n - 1) + "~" : s.padEnd(n));

export function printTable(items) {
  for (const it of items) console.log(`${it.status.padEnd(4)}  ${cell(it.kind, 7)}  ${cell(it.item, 40)}  ${it.evidence}  [${it.where}]`);
  const count = (s) => items.filter((i) => i.status === s).length;
  console.log(`\n${items.length} items: ${count("PASS")} PASS, ${count("FAIL")} FAIL${count("WARN") ? `, ${count("WARN")} WARN` : ""}`);
}

export function falsifier(textDir, codeDir, log) {
  const copy = tempDir("t0fly");
  try {
    fs.cpSync(textDir, copy, { recursive: true });
    fs.appendFileSync(path.join(copy, "SKILL.md"), FLY_LINE);
    const base = analyze({ textDir, codeDir }).filter((i) => i.status === "FAIL").map((i) => `${i.kind} ${i.item}`);
    const items = analyze({ textDir: copy, codeDir }), fails = items.filter((i) => i.status === "FAIL").map((i) => `${i.kind} ${i.item}`);
    const added = fails.filter((f) => !base.includes(f));
    const caught = added.includes("command studio fly");
    log(`${caught && added.length === 1 ? "PASS" : "FAIL"}  falsifier: text with an added line "run \`studio fly <dir>\`" ${caught ? "fails on `studio fly`" : "did NOT fail on `studio fly`"}; ${added.length} new FAIL line(s): ${added.join(", ") || "none"}`);
    return caught && added.length === 1;
  } finally { rmDir(copy); }
}

export function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const takes = new Set(["--repo", "--tools"]);
  const textDir = path.resolve(argv.find((a, i) => !a.startsWith("--") && !takes.has(argv[i - 1])) || DEFAULT_TEXT), codeDir = path.resolve(opt("--repo") || DEFAULT_CODE);
  if (!fs.existsSync(textDir)) usage(`${textDir} does not exist`);
  if (argv.includes("--tools") && !opt("--tools")) usage("--tools needs a file");
  if (argv.includes("--falsifier")) return falsifier(textDir, codeDir, console.log) ? EXIT.PASS : EXIT.FAIL;
  const items = analyze({ textDir, codeDir, toolsFile: opt("--tools") ? path.resolve(opt("--tools")) : null, run: argv.includes("--run"), log: console.log });
  console.log(`text: ${textDir}\ncode: ${codeDir}\n`);
  printTable(items);
  return items.some((i) => i.status === "FAIL") ? EXIT.FAIL : EXIT.PASS;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
