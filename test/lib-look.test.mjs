// Tests for `look`: argument parsing, the card page, the look.css checks, and (when the tool home is set up) a real run
// on a synthetic image that draws the card with HyperFrames.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILLDIR = path.join(ROOT, "skills", "synergy-studio");
const lib = (name) => import(pathToFileURL(path.join(SKILLDIR, "scripts", "lib", name)).href);
const { unsupportedInput, IMAGE_EXT, VIDEO_EXT, parseLookArgs, lookCssProblems, cardHtml, summary, LOOK_VARS, USAGE } = await lib("look.mjs");
const TEMPLATE = fs.readFileSync(path.join(SKILLDIR, "template", "look-card.html"), "utf8");
const LOOKS_CSS = fs.readFileSync(path.join(SKILLDIR, "template", "looks.css"), "utf8");
const made = [];
test.after(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const homeDir = process.env.SYNERGY_STUDIO_HOME
  || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite")
    : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "SynergyStudioLite")
      : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "synergy-studio-lite"));
const SKIP = fs.existsSync(path.join(homeDir, "env.json")) ? false : "the tool home is not set up (run setup)";

const goodCss = `/* comment */\n#root, #root[data-look]{\n${LOOK_VARS.map((v) => `  ${v}:#123456;`).join("\n")}\n}\n`;
const grainCss = `${goodCss}/* snippet:\n   <svg class="grain-overlay" width="100%" height="100%"><filter id="grainf"></filter><rect width="100%" height="100%" filter="url(#grainf)"/></svg> */\n#root .grain-overlay{opacity:0.1}\n`;

// ---------------------------------------------------------------- arguments
test("usage names both forms", () => {
  assert.match(USAGE, /^look <dir> --from /);
  assert.match(USAGE, /--card <paper\|midnight\|bold\|luxe>/);
});

test("parseLookArgs reads the folder and every file after --from", () => {
  assert.deepEqual(parseLookArgs(["proj", "--from", "a.mp4", "b.png", "c dir/d.jpg"]), { dir: "proj", from: ["a.mp4", "b.png", "c dir/d.jpg"], card: null });
  assert.deepEqual(parseLookArgs(["proj", "--card", "luxe"]), { dir: "proj", from: [], card: "luxe" });
});

test("parseLookArgs refuses what it cannot use, with a plain message", () => {
  assert.throws(() => parseLookArgs([]), /give the project folder/);
  assert.throws(() => parseLookArgs(["--from", "a.png"]), /give the project folder first/);
  assert.throws(() => parseLookArgs(["proj"]), /--from with at least one/);
  assert.throws(() => parseLookArgs(["proj", "--from"]), /--from with at least one/);
  assert.throws(() => parseLookArgs(["proj", "--card"]), /--card needs a look name/);
  assert.throws(() => parseLookArgs(["proj", "--card", "neon"]), /--card must be one of paper, midnight, bold, luxe/);
  assert.throws(() => parseLookArgs(["proj", "--from", "a.png", "--card", "paper"]), /not both/);
  assert.throws(() => parseLookArgs(["proj", "--nope"]), /unknown flag/);
  assert.throws(() => parseLookArgs(["proj", "other", "--from", "a.png"]), /unexpected argument "other"/);
});

// ---------------------------------------------------------------- inputs
test("unsupportedInput names the first file look cannot read, and only that", () => {
  assert.equal(unsupportedInput(["a.png", "b.MP4", "c.JPG"]), null);
  assert.match(unsupportedInput(["a.png", "/x/notes.txt", "b.pdf"]), /^notes\.txt is not an image or a video that look can read/);
  assert.doesNotMatch(unsupportedInput(["/some/dir/notes.txt"]), /\/some\/dir/);
});

test("the extension lists match look.py", () => {
  const py = fs.readFileSync(path.join(SKILLDIR, "scripts", "look.py"), "utf8");
  const list = (name) => [...py.match(new RegExp(`${name} = \\{([^}]*)\\}`))[1].matchAll(/"(\.\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(list("IMAGE_EXT"), [...IMAGE_EXT].sort());
  assert.deepEqual(list("VIDEO_EXT"), [...VIDEO_EXT].sort());
});

// ---------------------------------------------------------------- look.css checks
test("lookCssProblems accepts a complete look and names what is missing", () => {
  assert.deepEqual(lookCssProblems(goodCss), []);
  assert.deepEqual(lookCssProblems(goodCss.replace("--glow:#123456;", "")), ["--glow is not defined"]);
  assert.match(lookCssProblems("[data-look=custom]{--bg:#000}")[0], /no `#root, #root\[data-look\]/);
});

test("variables written in a comment do not count as defined", () => {
  const css = goodCss.replace("--ink:#123456;", "/* --ink:#123456; */");
  assert.deepEqual(lookCssProblems(css), ["--ink is not defined"]);
});

// ---------------------------------------------------------------- the card page
test("card page fills its three placeholders for a built in look", () => {
  const html = cardHtml(TEMPLATE, "paper", null);
  assert.match(html, /data-look="paper"/);
  assert.doesNotMatch(html, /\{\{|\}\}/);
  assert.doesNotMatch(html, /href="look\.css"/);
  assert.doesNotMatch(html, /grain-overlay"/);
});

test("card page for a custom look links look.css and adds the grain overlay only when the css styles it", () => {
  const plain = cardHtml(TEMPLATE, "custom", goodCss);
  assert.match(plain, /data-look="custom"/);
  assert.match(plain, /<link rel="stylesheet" href="look\.css">/);
  assert.doesNotMatch(plain, /<svg class="grain-overlay"/);
  const grainy = cardHtml(TEMPLATE, "custom", grainCss);
  assert.match(grainy, /<svg class="grain-overlay"[\s\S]*<\/svg>/);
  assert.doesNotMatch(grainy, /\{\{|\}\}/);
  assert.throws(() => cardHtml(TEMPLATE, "custom", `${goodCss}#root .grain-overlay{opacity:0.1}`), /holds no grain overlay markup/);
});

test("the placeholders are also replaced when the page mentions them more than once", () => {
  const html = cardHtml("{{LOOK}} {{LOOK}} {{LOOKCSS}} {{GRAIN}}", "bold", null);
  assert.equal(html, "bold bold  ");
});

test("card page uses only look variables, carries every bundled font rule, and touches no network", () => {
  const used = new Set([...TEMPLATE.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
  for (const v of used) assert.ok(LOOK_VARS.includes(v), `${v} is not a look variable`);
  for (const face of LOOKS_CSS.match(/@font-face\s*\{[^}]*\}/g)) assert.ok(TEMPLATE.includes(face), `missing from look-card.html: ${face}`);
  assert.doesNotMatch(TEMPLATE, /https?:/);
  assert.doesNotMatch(TEMPLATE, /\bMath\.random|Date\.now|setTimeout|@keyframes/);
  for (const part of ["h1", "card", "chip", "lbl"]) assert.match(TEMPLATE, new RegExp(`class="[^"]*\\b${part}\\b`), `no .${part} on the card`);
  assert.match(TEMPLATE, /k-shape/);
});

test("card page and script text follow the writing rules", () => {
  const files = [TEMPLATE, fs.readFileSync(path.join(SKILLDIR, "scripts", "lib", "look.mjs"), "utf8"), fs.readFileSync(path.join(SKILLDIR, "scripts", "look.py"), "utf8")];
  for (const text of files) {
    assert.doesNotMatch(text, /—|–/);
    assert.doesNotMatch(text, /\bv\d\b/);
  }
  assert.doesNotMatch(TEMPLATE, / - /);
});

// ---------------------------------------------------------------- summary
test("summary prints every measured number in plain language", () => {
  const ref = {
    frames: 32, sources: [{ file: "x.mp4", black_rows_removed: 10, black_columns_removed: 0 }],
    palette: [{ hex: "#141026", share: 0.42 }, { hex: "#E4E3DB", share: 0.34 }], background: { hex: "#141026", lightness: 6.01 }, mode: "dark",
    contrast: { best_pair: { ratio: 14.41 }, ink: { hex: "#E4E3DB", ratio: 14.41, adjusted: false } },
    grain: { value: 0.439, flat_share: 0.75, present: true, threshold: 0.4 }, edge_density: 0.0528,
    video: { fps: 24, cuts_per_minute: 20.64, motion_energy: 0.0483, motion_energy_without_cuts: 0.0344 },
  };
  const text = summary(ref);
  for (const s of ["32 frames", "#141026 42%", "dark", "14.41 : 1", "0.439", "texture overlay", "0.0528", "24 fps", "20.64 cuts per minute", "0.0483", "10 rows"]) assert.ok(text.includes(s), s);
  assert.match(summary({ ...ref, grain: { ...ref.grain, present: false } }), /below 0\.4: clean/);
});

// ---------------------------------------------------------------- a real run
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// a 320x180 PNG: cream left 3/4, orange right 1/4 (deterministic, no dependencies)
function png() {
  const w = 320, h = 180, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; const c = x < 240 ? [0xf4, 0xf1, 0xea] : [0xd9, 0x77, 0x5a]; raw.set(c, o + 1 + x * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio look test "));
  made.push(dir);
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ name: "t", aspect: "16:9", length: 10, mode: "film", scenes: [{ id: "s1", start: 0, end: 10 }] }));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  return dir;
}
function runLook(args) {
  const runner = path.join(os.tmpdir(), `look-runner-${process.pid}.mjs`);
  made.push(runner);
  fs.writeFileSync(runner, `import { main } from ${JSON.stringify(pathToFileURL(path.join(SKILLDIR, "scripts", "lib", "look.mjs")).href)};\nprocess.exitCode = await main(process.argv.slice(2));\n`);
  return spawnSync(process.execPath, [runner, ...args], { encoding: "utf8", shell: false });
}
const isJpeg = (f) => { const b = fs.readFileSync(f); return b[0] === 0xff && b[1] === 0xd8 && b.length > 5000; };

test("look --from on an image writes the reference, the css and a JPEG card", { skip: SKIP, timeout: 120000 }, () => {
  const dir = project(), img = path.join(dir, "ref image.png");
  fs.writeFileSync(img, png());
  const r = runLook([dir, "--from", img]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /look: measured 1 frame from ref image\.png/);
  const ref = JSON.parse(fs.readFileSync(path.join(dir, "look-reference.json"), "utf8"));
  assert.equal(ref.mode, "light");
  assert.equal(ref.background.hex, "#F4F1EA");
  assert.equal(ref.video, null);
  assert.deepEqual(lookCssProblems(fs.readFileSync(path.join(dir, "src", "look.css"), "utf8")), []);
  assert.ok(isJpeg(path.join(dir, "stills", "look-card.jpg")), "look-card.jpg is a JPEG");
});

test("look --card draws a built in look without measuring or touching look.css", { skip: SKIP, timeout: 120000 }, () => {
  const dir = project();
  const r = runLook([dir, "--card", "midnight"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(isJpeg(path.join(dir, "stills", "look-card-midnight.jpg")));
  assert.ok(!fs.existsSync(path.join(dir, "look-reference.json")));
  assert.ok(!fs.existsSync(path.join(dir, "src", "look.css")));
});

test("look refuses a bad call with exit 1 and a plain message", { skip: SKIP }, () => {
  const dir = project();
  const txt = path.join(dir, "notes.txt"); fs.writeFileSync(txt, "hello");
  const t = runLook([dir, "--from", txt]);
  assert.equal(t.status, 1);
  assert.match(t.stderr, /^ERROR: notes\.txt is not an image or a video that look can read.*\n$/);
  assert.equal(t.stderr.trim().split("\n").length, 1, "one plain ERROR line, nothing from python");
  for (const args of [[dir], [dir, "--card", "neon"], [dir, "--from", path.join(dir, "missing.png")]]) {
    const r = runLook(args);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, /^ERROR: /);
  }
});
