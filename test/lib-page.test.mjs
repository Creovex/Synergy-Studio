// Tests for the page side: compose lint (one fixture page per rule), budget defaults, caption record, frames, synctest judge.
// They use the installed tool home (setup must have run); without it every test that needs it is skipped with that reason.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = path.join(ROOT, "skills", "synergy-studio", "scripts");
const STUDIO = path.join(SCRIPTS, "studio.mjs");
const FIXTURES = path.join(ROOT, "test", "fixtures", "page");
const lib = (name) => import(pathToFileURL(path.join(SCRIPTS, "lib", name)).href);
const made = [];
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const homeDir = process.env.SYNERGY_STUDIO_HOME
  || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite")
    : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "SynergyStudioLite")
      : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "synergy-studio-lite"));
const SKIP = fs.existsSync(path.join(homeDir, "env.json")) ? false : "the tool home is not set up (run setup)";

// a 0.1 s silent 48 kHz mono WAV: only there so that compose has a mix file to copy
function silentWav() {
  const samples = 4800, data = Buffer.alloc(samples * 2), head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(48000, 24); head.writeUInt32LE(96000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// a project folder built from the fixtures: page = fixture file name, project = project fixture file name
function project(page, projectFile = "project.json", transcript = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio page test "));
  made.push(dir);
  fs.mkdirSync(path.join(dir, "src", "assets"), { recursive: true });
  fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, `${page}.html`), path.join(dir, "src", "index.html"));
  fs.copyFileSync(path.join(FIXTURES, projectFile), path.join(dir, "project.json"));
  fs.copyFileSync(path.join(FIXTURES, "timing.json"), path.join(dir, "timing.json"));
  fs.writeFileSync(path.join(dir, "timing.js"), "window.TIMING = " + fs.readFileSync(path.join(FIXTURES, "timing.json"), "utf8") + ";\n");
  fs.writeFileSync(path.join(dir, "audio", "mix.wav"), silentWav());
  if (transcript) fs.copyFileSync(path.join(FIXTURES, "transcript.json"), path.join(dir, "transcript.json"));
  return dir;
}
const studio = (...args) => spawnSync(process.execPath, [STUDIO, ...args], { encoding: "utf8" });

// T2: every compose lint rule has a fixture page that compose refuses with that rule's message
const RULES = [
  ["math-random", "not allowed: Math.random"],
  ["date-now", "not allowed: Date.now"],
  ["new-date", "not allowed: new Date("],
  ["performance-now", "not allowed: performance.now"],
  ["set-timeout", "not allowed: setTimeout"],
  ["set-interval", "not allowed: setInterval"],
  ["request-animation-frame", "not allowed: requestAnimationFrame"],
  ["keyframes", "not allowed: CSS @keyframes"],
  ["css-animation", "not allowed: CSS animation:"],
  ["css-transition", "not allowed: CSS transition:"],
  ["gsap-from", "not allowed: gsap .from("],
  ["gsap-fromto", "not allowed: gsap .fromTo("],
  ["url-src", "not allowed: network URL in src"],
  ["url-href", "not allowed: network URL in href"],
  ["url-css", "not allowed: network URL in url("],
  ["url-import", "not allowed: network URL in an import"],
  ["scene-without-element", 'scene s1: no element with id="s1"'],
  ["data-start-without-id", "every element with data-start needs a unique id"],
  ["leftover-placeholder", "unfilled placeholders: {{nope}}"],
];
for (const [fixture, message] of RULES) {
  test(`compose refuses ${fixture} with its own message`, { skip: SKIP }, () => {
    const dir = project(fixture);
    const r = studio("compose", dir);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(message), `expected "${message}" in:\n${r.stderr}`);
    if (message.startsWith("not allowed:")) assert.equal(r.stderr.split("\n").filter((l) => l.includes("not allowed:")).length, 1, "exactly one rule fires\n" + r.stderr);
    assert.ok(!fs.existsSync(path.join(dir, "comp", "index.html")), "nothing is composed");
  });
}

test("compose refuses an unknown project.json field", { skip: SKIP }, () => {
  const dir = project("clean", "project-unknown-field.json");
  const r = studio("compose", dir);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stderr.includes('project.json: unknown field "colour"'), r.stderr);
});

test("compose lists every hit, not only the first", { skip: SKIP }, () => {
  const dir = project("math-random", "project-unknown-field.json");
  const r = studio("compose", dir);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes("Math.random") && r.stderr.includes('unknown field "colour"'), r.stderr);
});

test("a clean page composes (falsifier for the lint rules)", { skip: SKIP }, () => {
  const dir = project("clean");
  const r = studio("compose", dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of ["index.html", "lib.js", "looks.css", "sketch.js", "timing.js", "words.js", "gsap.min.js", path.join("audio", "mix.wav")]) assert.ok(fs.existsSync(path.join(dir, "comp", f)), f);
  const html = fs.readFileSync(path.join(dir, "comp", "index.html"), "utf8");
  assert.ok(!/\{\{/.test(html), "every placeholder is filled");
  assert.ok(/@font-face/.test(html), "the bundled font rules are in the page itself, so nothing is downloaded at render time");
});

test("the composed page never names a font or script host on the network", { skip: SKIP }, () => {
  const dir = project("clean");
  assert.equal(studio("compose", dir).status, 0);
  const html = fs.readFileSync(path.join(dir, "comp", "index.html"), "utf8");
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|https?:\/\//.test(html));
});

test("budget uses the defaults for the aspect when project.json omits the timing fields", { skip: SKIP }, () => {
  const make = (aspect) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio budget test "));
    made.push(dir);
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ name: "b", aspect, length: 30, scenes: [{ id: "s1", say: "a" }, { id: "s2", say: "b" }] }));
    return dir;
  };
  const vertical = studio("budget", make("9:16")).stdout, wide = studio("budget", make("16:9")).stdout;
  assert.match(vertical, /lead 0\.4, pre 0\.3 and post 0\.7 per scene, tail 2/);
  assert.match(wide, /lead 0\.9, pre 0\.6 and post 1\.2 per scene, tail 2\.5/);
});

test("captions() records its groups and words with their times in window.__SS.captions", { skip: SKIP }, async () => {
  const dir = project("captions", "project.json", true);
  assert.equal(studio("compose", dir).status, 0);
  const { readCaptions } = await lib("render.mjs");
  const { loadEnv } = await lib("env.mjs");
  const record = await readCaptions(loadEnv(homeDir), path.join(dir, "comp"));
  assert.ok(Array.isArray(record) && record.length >= 1);
  const words = record.flatMap((g) => g.words.map((w) => w.text));
  assert.deepEqual(words, ["Small", "sips", "all", "day."]);
  for (const g of record) {
    assert.ok(g.end > g.start);
    for (const w of g.words) assert.ok(w.end > w.start && w.start >= g.start - 1e-9);
  }
  assert.equal(record[0].words[0].start, 0.2);
});

test("a page that never calls captions() has no record", { skip: SKIP }, async () => {
  const dir = project("clean");
  assert.equal(studio("compose", dir).status, 0);
  const { readCaptions } = await lib("render.mjs");
  const { loadEnv } = await lib("env.mjs");
  assert.equal(await readCaptions(loadEnv(homeDir), path.join(dir, "comp")), null);
});

test("an unknown captions style is refused by the page", () => {
  const source = fs.readFileSync(path.join(SCRIPTS, "..", "template", "lib.js"), "utf8");
  assert.match(source, /captions style must be "color", "pop" or "box"/);
});

test("frames makes one sheet of any video and refuses bad arguments", { skip: SKIP }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio frames test "));
  made.push(dir);
  const ffmpeg = process.platform === "win32" ? path.join(homeDir, "bin", "ffmpeg.exe") : path.join(homeDir, "bin", "ffmpeg");
  const clip = path.join(dir, "clip.mp4");
  const made1 = spawnSync(ffmpeg, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x180:rate=10", "-pix_fmt", "yuv420p", clip], { encoding: "utf8" });
  assert.equal(made1.status, 0, made1.stderr);
  const out = path.join(dir, "sheet.jpg");
  const r = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(pathToFileURL(path.join(SCRIPTS, "lib", "frames.mjs")).href)}).then(m => m.main(process.argv.slice(1))).then(c => process.exit(c))`, clip, "--n", "6", "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.statSync(out).size > 1000);
  const bad = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(pathToFileURL(path.join(SCRIPTS, "lib", "frames.mjs")).href)}).then(m => m.main(process.argv.slice(1)))`, clip, "--n", "0"], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.ok(bad.stderr.includes("--n needs a whole number"));
});

test("synctest passes a pair within one frame and fails one 3 frames late", async () => {
  const { judge } = await lib("synctest.mjs");
  const good = judge({ flashes: [2, 4.5, 7], beeps: [2.004, 4.5, 6.998] });
  assert.equal(good.pass, true);
  assert.equal(good.pairs.length, 3);
  const late = judge({ flashes: [2, 4.5, 7], beeps: [2.1, 4.6, 7.1] });
  assert.equal(late.pass, false);
  assert.equal(late.mean_offset_ms, 100);
  assert.equal(judge({ flashes: [2, 4.5], beeps: [2, 4.5, 7] }).pass, false);
});
