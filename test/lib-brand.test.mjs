// Tests for `brand`: argument parsing, the default pictures, the verdict words, and (when the tool home is set up) real
// runs of brand_coverage.py on small synthetic pictures, including the exit code 2 for a flooded picture.
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
const BRAND_URL = pathToFileURL(path.join(SKILLDIR, "scripts", "lib", "brand.mjs")).href;
const { USAGE, normaliseHex, parseBrandArgs, defaultImages, resolveImage, verdictOf, summary, measureFailure } = await import(BRAND_URL);
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "brand-test-")); made.push(d); return d; };
test.after(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const homeDir = process.env.SYNERGY_STUDIO_HOME
  || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite")
    : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "SynergyStudioLite")
      : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "synergy-studio-lite"));
const SKIP = fs.existsSync(path.join(homeDir, "env.json")) ? false : "the tool home is not set up (run setup)";

// ---------------------------------------------------------------- arguments
test("usage names the folder, --brand and the pictures", () => {
  assert.match(USAGE, /^brand <dir> --brand "#hex"/);
  assert.match(USAGE, /\[images/);
});

test("normaliseHex gives six upper case digits with a #", () => {
  assert.equal(normaliseHex("#2a67b7"), "#2A67B7");
  assert.equal(normaliseHex("2A67B7"), "#2A67B7");
  assert.equal(normaliseHex("#2ab"), "#22AABB");
  assert.equal(normaliseHex(" #fdfaf4 "), "#FDFAF4");
});

test("normaliseHex refuses what is not a colour, with the value in the message", () => {
  for (const bad of ["blue", "#12345", "#GG0000", "", "#2A67B7FF"]) assert.throws(() => normaliseHex(bad), /is not a hex colour/);
  assert.throws(() => normaliseHex("blue"), /"blue"/);
});

test("parseBrandArgs reads the folder, every --brand and the pictures after", () => {
  assert.deepEqual(parseBrandArgs(["proj", "--brand", "#2A67B7"]), { dir: "proj", brands: ["#2A67B7"], images: [] });
  assert.deepEqual(parseBrandArgs(["proj", "--brand", "#2a67b7", "--brand", "b9d1e6", "a.png", "stills/b.png"]),
    { dir: "proj", brands: ["#2A67B7", "#B9D1E6"], images: ["a.png", "stills/b.png"] });
  assert.deepEqual(parseBrandArgs(["--brand", "#2A67B7", "proj", "a.png"]), { dir: "proj", brands: ["#2A67B7"], images: ["a.png"] });
  assert.deepEqual(parseBrandArgs(["proj", "--brand=#2A67B7"]).brands, ["#2A67B7"]);
});

test("parseBrandArgs keeps a repeated colour once", () => {
  assert.deepEqual(parseBrandArgs(["proj", "--brand", "#2A67B7", "--brand", "#2a67b7"]).brands, ["#2A67B7"]);
});

test("parseBrandArgs refuses what it cannot use, with a plain message", () => {
  assert.throws(() => parseBrandArgs([]), /give the project folder first/);
  assert.throws(() => parseBrandArgs(["--brand", "#2A67B7"]), /give the project folder first/);
  assert.throws(() => parseBrandArgs(["proj"]), /at least one --brand/);
  assert.throws(() => parseBrandArgs(["proj", "--brand"]), /--brand needs a hex colour/);
  assert.throws(() => parseBrandArgs(["proj", "--brand", "--brand", "#2A67B7"]), /--brand needs a hex colour/);
  assert.throws(() => parseBrandArgs(["proj", "--brand", "navy"]), /"navy" is not a hex colour/);
  assert.throws(() => parseBrandArgs(["proj", "--brand", "#2A67B7", "--nope"]), /unknown flag --nope/);
});

// ---------------------------------------------------------------- pictures
test("defaultImages lists the project's frames in time order and nothing else", () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, "stills"));
  for (const f of ["frame-02-at-4s.png", "frame-01-at-0.3s.png", "sheet.jpg", "safe-tiktok.jpg", "frame-01-at-0.3s-tiktok-safe.jpg", "cues.txt"]) fs.writeFileSync(path.join(d, "stills", f), "x");
  assert.deepEqual(defaultImages(d).map((f) => path.basename(f)), ["frame-01-at-0.3s.png", "frame-02-at-4s.png"]);
});

test("defaultImages says to run stills when there are none", () => {
  const d = tmp();
  assert.throws(() => defaultImages(d), /no stills in .* yet: run studio stills first/);
  fs.mkdirSync(path.join(d, "stills"));
  fs.writeFileSync(path.join(d, "stills", "sheet.jpg"), "x");
  assert.throws(() => defaultImages(d), /run studio stills first/);
});

test("resolveImage finds a picture relative to the project, or says where it looked", () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, "stills"));
  fs.writeFileSync(path.join(d, "stills", "a.png"), "x");
  assert.equal(resolveImage(d, "stills/a.png"), path.join(d, "stills", "a.png"));
  assert.equal(resolveImage(d, path.join(d, "stills", "a.png")), path.join(d, "stills", "a.png"));
  assert.throws(() => resolveImage(d, "stills/none.png"), /picture not found: stills\/none\.png \(looked in /);
  assert.throws(() => resolveImage(d, "stills"), /picture not found/);      // a folder is not a picture
});

// ---------------------------------------------------------------- verdicts
test("verdictOf reads the verdict line of the script", () => {
  assert.equal(verdictOf("x\nVERDICT: ACCENT (the brand colour is an accent)\n"), "ACCENT");
  assert.equal(verdictOf("VERDICT: HEAVY (fine)"), "HEAVY");
  assert.equal(verdictOf("a\nVERDICT: FLOODED (the brand colour is the wallpaper)"), "FLOODED");
  assert.equal(verdictOf("no verdict here"), null);
  assert.equal(verdictOf(""), null);
  assert.equal(verdictOf(undefined), null);
  assert.equal(verdictOf("a VERDICT: FLOODED mid line"), null);
});

test("summary counts the pictures and names a flooded one", () => {
  assert.equal(summary(["ACCENT"]), "brand: 1 picture: 1 ACCENT");
  assert.equal(summary(["ACCENT", "HEAVY", "ACCENT"]), "brand: 3 pictures: 2 ACCENT, 1 HEAVY");
  assert.match(summary(["ACCENT", "FLOODED"]), /^brand: 2 pictures: 1 ACCENT, 1 FLOODED\. 1 FLOODED: the brand colour is the wallpaper, rebuild the palette \(references\/brand-colours\.md\)$/);
});

// ---------------------------------------------------------------- real runs
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
// an RGB picture of w x h whose first `left` columns are colour a and the rest colour b
function png(w, h, a, b, left) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) (x < left ? a : b).forEach((v, i) => { row[1 + x * 3 + i] = v; });
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// an RGBA picture of one colour (the last number is the alpha)
function rgbaPng(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.alloc(1 + w * 4);
  for (let x = 0; x < w; x++) rgba.forEach((v, i) => { row[1 + x * 4 + i] = v; });
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const BLUE = [0x2a, 0x67, 0xb7], TERRACOTTA = [0xe0, 0x7a, 0x5f];

function project(pictures) {
  const d = tmp();
  fs.writeFileSync(path.join(d, "project.json"), JSON.stringify({ name: "brandtest" }));
  fs.mkdirSync(path.join(d, "stills"));
  for (const [name, buf] of Object.entries(pictures)) fs.writeFileSync(path.join(d, "stills", name), buf);
  return d;
}
const cli = (args) => spawnSync(process.execPath, ["--input-type=module", "-e",
  `import(${JSON.stringify(BRAND_URL)}).then(async (m) => { process.exitCode = await m.main(${JSON.stringify(args)}); });`],
  { encoding: "utf8", env: { ...process.env, SYNERGY_STUDIO_HOME: homeDir } });

test("a flooded frame exits 2 and an accent frame exits 0", { skip: SKIP }, () => {
  const flooded = project({ "frame-01-at-1s.png": png(120, 120, BLUE, BLUE, 120) });
  let r = cli([flooded, "--brand", "#2A67B7"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /VERDICT: FLOODED/);
  assert.match(r.stdout, /brand: 1 picture: 1 FLOODED\. 1 FLOODED:/);
  const warm = project({ "frame-01-at-1s.png": png(120, 120, BLUE, TERRACOTTA, 6) });
  r = cli([warm, "--brand", "#2A67B7"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /VERDICT: ACCENT/);
  assert.match(r.stdout, /^brand: 1 picture: 1 ACCENT$/m);
});

test("every still is measured by default and one flooded still fails the run", { skip: SKIP }, () => {
  const d = project({ "frame-01-at-0.3s.png": png(120, 120, BLUE, TERRACOTTA, 6), "frame-02-at-4s.png": png(120, 120, BLUE, BLUE, 120), "sheet.jpg": "not a picture" });
  const r = cli([d, "--brand", "#2a67b7"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal((r.stdout.match(/^VERDICT: /gm) || []).length, 2);
  assert.ok(r.stdout.indexOf("frame-01-at-0.3s.png") < r.stdout.indexOf("frame-02-at-4s.png"));
  assert.match(r.stdout, /brand: 2 pictures: 1 ACCENT, 1 FLOODED/);
});

test("named pictures replace the stills, and a heavy picture still exits 0", { skip: SKIP }, () => {
  const d = project({ "frame-01-at-1s.png": png(120, 120, BLUE, BLUE, 120), "other.png": png(120, 120, BLUE, TERRACOTTA, 30) });
  const r = cli([d, "--brand", "#2A67B7", "stills/other.png"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /VERDICT: HEAVY/);
  assert.equal((r.stdout.match(/^VERDICT: /gm) || []).length, 1);
});

test("a broken picture and a missing colour are plain errors with exit 1", { skip: SKIP }, () => {
  const d = project({ "frame-01-at-1s.png": "not a picture" });
  let r = cli([d, "--brand", "#2A67B7"]);
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, r.stderr);                     // one plain line, no raw ffmpeg output
  assert.match(lines[0], /^ERROR: .*frame-01-at-1s\.png is not a picture ffmpeg can read$/);
  assert.doesNotMatch(r.stderr, /brand_coverage|Error opening/);
  r = cli([d]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ERROR: give at least one --brand/m);
  r = cli([path.join(d, "missing"), "--brand", "#2A67B7"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /has no project\.json/);
});

test("fully transparent pixels are not counted as the brand colour", { skip: SKIP }, () => {
  const ghost = project({ "frame-01-at-1s.png": rgbaPng(64, 64, [...BLUE, 0]) });
  let r = cli([ghost, "--brand", "#2A67B7"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /VERDICT: ACCENT/);
  assert.match(r.stdout, /transparent \(not counted\): 100\.0%/);
  const solid = project({ "frame-01-at-1s.png": rgbaPng(64, 64, [...BLUE, 255]) });
  r = cli([solid, "--brand", "#2A67B7"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /VERDICT: FLOODED/);
});

test("measureFailure gives one plain line and never the script name", () => {
  assert.equal(measureFailure("a.png", { stderr: "/x/a.png is not a picture ffmpeg can read\n" }), "/x/a.png is not a picture ffmpeg can read");
  assert.equal(measureFailure("a.png", { stderr: "Traceback (most recent call last):\n  File x\nModuleNotFoundError: No module named 'numpy'\n" }), "could not measure a.png: ModuleNotFoundError: No module named 'numpy'");
  assert.equal(measureFailure("a.png", { stderr: "", status: 3 }), "could not measure a.png: exit 3");
});

test("a project with no stills asks for stills first", { skip: SKIP }, () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "project.json"), "{}");
  const r = cli([d, "--brand", "#2A67B7"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ERROR: no stills in .* yet: run studio stills first/m);
});
