// SoundFont installation: the SOUNDFONTS table, the fonts.json record, ids, setup --soundfont, the doctor "instruments"
// line and `studio sounds`. No network: a SoundFont is a small file, and the venv Python is a shell script that answers
// the way instruments.py does.
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
const lib = (name) => import(pathToFileURL(path.join(SCRIPTS, "lib", name)).href);
const unix = { skip: process.platform === "win32" ? "the fake Python is a shell script" : false };
const made = [];
const scratch = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio font test "));
  made.push(dir);
  return dir;
};
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const MUSESCORE_SHA = "5b85b6c2c61d10b2b91cddd41efcce7b25cd31c8271d511c73afafbef20b6fa3";

// A venv Python that answers like the real one. Files whose first line is SOUNDFONT load; anything else gives the
// instruments.py ERROR line and exit 1. `version` is what "import tinysoundfont" prints; null means it does not import.
function fakePython(home, { version = "0.3.7", listing = "musescore-lite: MuseScore_General.sf3" } = {}) {
  const file = path.join(home, "venv", "bin", "python");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const importPart = version === null
    ? 'echo "ModuleNotFoundError: No module named tinysoundfont" >&2; exit 1'
    : `echo ${version}; exit 0`;
  fs.writeFileSync(file, `#!/bin/sh
if [ "$1" = "-c" ]; then
  case "$2" in
    *tinysoundfont*) ${importPart} ;;
    *) exit 1 ;;
  esac
fi
case "$2" in
  check)
    if [ "$(head -c 9 "$3")" = "SOUNDFONT" ]; then echo "ok 128 programs, 37 drum kits"; exit 0; fi
    echo "ERROR: the SoundFont could not be read (Could not load SoundFont file: $3). Use a .sf2 or .sf3 General MIDI SoundFont" >&2
    exit 1 ;;
  list)
    echo "ARGS: $*"
    echo ${JSON.stringify(listing)}
    exit 0 ;;
esac
exit 1
`, { mode: 0o755 });
  return file;
}

function envFor(home, python) {
  const gone = (name) => path.join(home, "missing", name);
  return {
    home, platform: process.platform, arch: "arm64", node: gone("node"), npm_cli: gone("npm"), uv: gone("uv"),
    python, node_modules: gone("node_modules"), hyperframes: gone("hf.mjs"), hf_home: gone("hf-home"),
    bin: gone("bin"), ffmpeg: gone("ffmpeg"), ffprobe: gone("ffprobe"), kokoro_model: gone("m.onnx"), kokoro_voices: gone("v.bin"),
    // a stored synctest result that matches the (missing) HyperFrames and browser, so doctor does not run a real synctest
    synctest: { hyperframes_version: null, browser_version: null, mean_offset_ms: 1 },
  };
}

const fontFile = (dir, name, body = "SOUNDFONT test bytes") => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
};

// ---------------------------------------------------------------- the table and the record

test("SOUNDFONTS holds the measured facts of the fonts setup knows", async () => {
  const { SOUNDFONTS, DEFAULT_SOUNDFONT } = await lib("setup.mjs");
  assert.equal(DEFAULT_SOUNDFONT, "musescore-lite");
  const muse = SOUNDFONTS["musescore-lite"];
  assert.equal(muse.file, "MuseScore_General.sf3");
  assert.equal(muse.url, "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3");
  assert.equal(muse.size, 39900972);
  assert.equal(muse.sha256, MUSESCORE_SHA);
  const fluid = SOUNDFONTS.fluidr3;
  assert.equal(fluid.file, "FluidR3_GM2-2.sf2");
  assert.equal(fluid.size, 148345256);
  assert.equal(fluid.sha256, "2ae766ab5c5deb6f7fffacd6316ec9f3699998cce821df3163e7b10a78a64066");
  assert.equal(fluid.archive.url, "https://ftp.osuosl.org/pub/musescore/soundfont/fluid-soundfont.tar.gz");
  assert.equal(fluid.archive.size, 130294103);
  assert.equal(fluid.archive.sha256, "c815769e44d86f1507b946a6c48c997c7f650699aea1ec4b11ba66e3415c26b9");
  assert.equal(fluid.archive.member, "FluidR3 GM2-2.SF2");
  assert.equal(SOUNDFONTS["generaluser-gs"].url, undefined, "never downloaded by setup");
  assert.equal(SOUNDFONTS["generaluser-gs"].fromFileOnly, true);
});

test("ids: a known sha256 wins, then GeneralUser in any case, then a slug of the file name", async () => {
  const { fontIdFor, slugify } = await lib("setup.mjs");
  assert.equal(fontIdFor({ sha256: MUSESCORE_SHA, fileName: "renamed.sf3" }), "musescore-lite");
  assert.equal(fontIdFor({ sha256: "0".repeat(64), fileName: "GeneralUser GS v2.0.1.sf2" }), "generaluser-gs");
  assert.equal(fontIdFor({ sha256: "0".repeat(64), fileName: "my-GENERALUSER.sf3" }), "generaluser-gs");
  assert.equal(fontIdFor({ sha256: "0".repeat(64), fileName: "Arachno_SoundFont Version 1.0.sf2" }), "arachno-soundfont-version-1-0");
  assert.equal(slugify("Piano_Only (v2).SF3"), "piano-only-v2");
  assert.equal(slugify("%%%.sf2"), "soundfont");
});

test("fonts.json: the first font becomes the default and installing another keeps it", async () => {
  const { readFonts, writeFonts, addFont, listedFonts } = await lib("setup.mjs");
  const home = scratch();
  assert.deepEqual(readFonts(home), { default: null, fonts: {} });
  const one = addFont(readFonts(home), "musescore-lite", { file: "a.sf3", sha256: "aa", source: "u" });
  assert.equal(one.default, "musescore-lite");
  const two = addFont(one, "fluidr3", { file: "b.sf2", sha256: "bb", source: "v" });
  assert.equal(two.default, "musescore-lite");
  assert.deepEqual(Object.keys(two.fonts), ["musescore-lite", "fluidr3"]);
  assert.equal(addFont(two, "fluidr3", { file: "b.sf2", sha256: "bb", source: "v" }, { asDefault: true }).default, "fluidr3");
  assert.equal(addFont({ default: "gone", fonts: {} }, "x", { file: "x.sf2", sha256: "x", source: "x" }).default, "x", "a default that is not listed is replaced");
  assert.equal(one.fonts["musescore-lite"].file, "a.sf3", "the input record is not changed");
  assert.equal(listedFonts(two), "musescore-lite (default), fluidr3");
  writeFonts(home, two);
  assert.deepEqual(readFonts(home), two);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(home, "soundfonts", "fonts.json"), "utf8"))), ["default", "fonts"]);
  assert.deepEqual(fs.readdirSync(path.join(home, "soundfonts")), ["fonts.json"], "no .part file is left");
});

test("fonts.json that is broken or has the wrong shape reads as no fonts", async () => {
  const { readFonts } = await lib("setup.mjs");
  const home = scratch();
  fs.mkdirSync(path.join(home, "soundfonts"));
  fs.writeFileSync(path.join(home, "soundfonts", "fonts.json"), "{nope");
  assert.deepEqual(readFonts(home), { default: null, fonts: {} });
  fs.writeFileSync(path.join(home, "soundfonts", "fonts.json"), JSON.stringify({ default: 7, fonts: [] }));
  assert.deepEqual(readFonts(home), { default: null, fonts: {} });
});

test("fontState: ok, file missing, sha256 differs, and the size of a known font", async () => {
  const { fontState } = await lib("setup.mjs");
  const home = scratch();
  const dir = path.join(home, "soundfonts");
  fs.mkdirSync(dir);
  const file = fontFile(dir, "mine.sf2", "SOUNDFONT one");
  const sha = (await lib("run.mjs")).sha256File;
  const good = await sha(file);
  const reg = { default: "mine", fonts: { mine: { file: "mine.sf2", sha256: good, source: "x" } } };
  assert.equal((await fontState(home, reg, "mine")).ok, true);
  fs.writeFileSync(file, "SOUNDFONT two");
  const bad = await fontState(home, reg, "mine");
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /sha256 differs from fonts\.json/);
  fs.rmSync(file);
  assert.match((await fontState(home, reg, "mine")).reason, /mine\.sf2 is missing/);
  assert.match((await fontState(home, reg, "other")).reason, /no file for other/);
  fontFile(dir, "MuseScore_General.sf3", "far too small");
  const known = { default: "musescore-lite", fonts: { "musescore-lite": { file: "MuseScore_General.sf3", sha256: MUSESCORE_SHA, source: "x" } } };
  assert.match((await fontState(home, known, "musescore-lite")).reason, /wrong size/);
});

// ---------------------------------------------------------------- setup --soundfont

test("setup parseArgs: --soundfont takes an id or a file, and the usage text shows it", async () => {
  const { parseArgs, USAGE } = await lib("setup.mjs");
  assert.equal(parseArgs(["--soundfont", "fluidr3"]).soundfont, "fluidr3");
  assert.equal(parseArgs(["--soundfont", "/a b/c.sf2", "--relock"]).soundfont, "/a b/c.sf2");
  assert.equal(parseArgs([]).soundfont, null);
  assert.throws(() => parseArgs(["--soundfont"]), /--soundfont needs a SoundFont id or file/);
  assert.throws(() => parseArgs(["--soundfont", "--relock"]), /--soundfont needs/);
  assert.throws(() => parseArgs(["--bogus"]), /Usage: setup \[--relock\] \[--whisper-model <file>\] \[--soundfont <id\|file>\]/);
  assert.match(USAGE, /--soundfont id\|file/);
});

test("setup --soundfont <file> copies a font that loads, names its id, and keeps the first one as the default", unix, async () => {
  const { installSoundfont, readFonts } = await lib("setup.mjs");
  const home = scratch();
  const env = envFor(home, fakePython(home));
  const source = scratch();
  const first = await installSoundfont(home, env, fontFile(source, "GeneralUser GS 2.sf2", "SOUNDFONT general"));
  assert.equal(first.id, "generaluser-gs");
  assert.equal(first.reg.default, "generaluser-gs");
  assert.ok(fs.existsSync(path.join(home, "soundfonts", "GeneralUser GS 2.sf2")));
  assert.equal(first.entry.source, path.join(source, "GeneralUser GS 2.sf2"));
  const second = await installSoundfont(home, env, fontFile(source, "Piano Only.SF3", "SOUNDFONT piano"));
  assert.equal(second.id, "piano-only");
  assert.equal(second.reg.default, "generaluser-gs", "the default stays");
  assert.deepEqual(Object.keys(readFonts(home).fonts), ["generaluser-gs", "piano-only"]);
  assert.deepEqual(fs.readdirSync(path.join(home, "soundfonts")).sort(), ["GeneralUser GS 2.sf2", "Piano Only.SF3", "fonts.json"]);
});

test("setup --soundfont refuses a file that does not load with the instruments.py ERROR, and copies nothing", unix, async () => {
  const { installSoundfont, readFonts } = await lib("setup.mjs");
  const home = scratch();
  const env = envFor(home, fakePython(home));
  const source = scratch();
  await assert.rejects(
    installSoundfont(home, env, fontFile(source, "fake.sf2", "plain text, not a SoundFont")),
    /the SoundFont could not be read .*fake\.sf2 was not copied/,
  );
  await assert.rejects(installSoundfont(home, env, "/etc/hosts"), /the SoundFont could not be read/);
  assert.equal(fs.existsSync(path.join(home, "soundfonts", "fake.sf2")), false);
  assert.equal(fs.existsSync(path.join(home, "soundfonts", "hosts")), false);
  assert.deepEqual(readFonts(home), { default: null, fonts: {} });
});

test("setup --soundfont never overwrites a different file of the same name, and never lists a clashing id", unix, async () => {
  const { installSoundfont, readFonts } = await lib("setup.mjs");
  const home = scratch();
  const env = envFor(home, fakePython(home));
  const a = scratch();
  const b = scratch();
  const original = fontFile(a, "Same.sf2", "SOUNDFONT original");
  await installSoundfont(home, env, original);
  await assert.rejects(installSoundfont(home, env, fontFile(b, "Same.sf2", "SOUNDFONT different")), /already exists and is a different file/);
  assert.equal(fs.readFileSync(path.join(home, "soundfonts", "Same.sf2"), "utf8"), "SOUNDFONT original");
  const again = await installSoundfont(home, env, original);
  assert.equal(again.id, "same", "the same file again is fine");
  await assert.rejects(installSoundfont(home, env, fontFile(b, "same.sf3", "SOUNDFONT third")), /already names Same\.sf2/);
  assert.equal(fs.existsSync(path.join(home, "soundfonts", "same.sf3")), false, "a clashing id copies nothing");
  assert.deepEqual(Object.keys(readFonts(home).fonts), ["same"]);
});

test("setup --soundfont: a file that loads but is not named .sf2 or .sf3, a name that is nothing, and generaluser-gs without a file", unix, async () => {
  const { installSoundfont } = await lib("setup.mjs");
  const home = scratch();
  const env = envFor(home, fakePython(home));
  const source = scratch();
  await assert.rejects(installSoundfont(home, env, fontFile(source, "font.bin", "SOUNDFONT x")), /not named \.sf2 or \.sf3/);
  await assert.rejects(installSoundfont(home, env, "no-such-font"), /not a SoundFont id \(musescore-lite, fluidr3, generaluser-gs\) and not a file/);
  await assert.rejects(installSoundfont(home, env, "generaluser-gs"), /not downloaded by setup; give the file/);
  assert.equal(fs.existsSync(path.join(home, "soundfonts")), false, "nothing was created");
});

test("the same font given again under another name that gives the same id is not copied twice", unix, async () => {
  const { installSoundfont, readFonts } = await lib("setup.mjs");
  const home = scratch();
  const env = envFor(home, fakePython(home));
  const source = scratch();
  const first = await installSoundfont(home, env, fontFile(source, "GeneralUser A.sf2", "SOUNDFONT general"));
  const again = await installSoundfont(home, env, fontFile(source, "GeneralUser B.sf2", "SOUNDFONT general"));
  assert.equal(again.id, "generaluser-gs");
  assert.deepEqual(again.entry, first.entry, "the listed entry (and its source) is kept");
  assert.equal(fs.existsSync(path.join(home, "soundfonts", "GeneralUser B.sf2")), false);
  await assert.rejects(installSoundfont(home, env, fontFile(source, "GeneralUser C.sf2", "SOUNDFONT other")), /already names GeneralUser A\.sf2/);
  assert.deepEqual(Object.keys(readFonts(home).fonts), ["generaluser-gs"]);
});

// ---------------------------------------------------------------- doctor

test("doctor instruments line: installed and matching, with the other fonts named", async () => {
  const { instrumentsResult } = await lib("doctor.mjs");
  const home = scratch();
  const dir = path.join(home, "soundfonts");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "FluidR3_GM2-2.sf2"), "x");
  const reg = {
    default: "musescore-lite",
    fonts: {
      "musescore-lite": { file: "MuseScore_General.sf3", sha256: MUSESCORE_SHA },
      fluidr3: { file: "FluidR3_GM2-2.sf2", sha256: "bb" },
      gone: { file: "not-there.sf2", sha256: "cc" },
    },
  };
  const line = instrumentsResult({ version: "0.3.7", reg, state: { ok: true, file: path.join(dir, "MuseScore_General.sf3") } });
  assert.equal(line.status, "PASS");
  assert.equal(line.check, "instruments");
  assert.equal(line.detail, "tinysoundfont 0.3.7, default font musescore-lite (MuseScore_General.sf3, sha256 matches); also installed: fluidr3");
  const alone = instrumentsResult({ version: "0.3.7", reg: { default: "musescore-lite", fonts: { "musescore-lite": reg.fonts["musescore-lite"] } }, state: { ok: true, file: path.join(dir, "x") } });
  assert.equal(alone.detail, "tinysoundfont 0.3.7, default font musescore-lite (MuseScore_General.sf3, sha256 matches)");
});

test("doctor instruments line: tinysoundfont missing, wrong version, no fonts, sha mismatch, file missing", async () => {
  const { instrumentsResult } = await lib("doctor.mjs");
  const { SOUNDFONT_FIX } = await lib("setup.mjs");
  const listed = { default: "musescore-lite", fonts: { "musescore-lite": { file: "MuseScore_General.sf3", sha256: MUSESCORE_SHA } } };
  const noModule = instrumentsResult({ version: null, reg: listed, state: null, importError: "No module named 'tinysoundfont'" });
  assert.equal(noModule.status, "FAIL");
  assert.match(noModule.detail, /tinysoundfont is not usable \(No module named 'tinysoundfont'\)/);
  assert.equal(noModule.fix, "run setup again");
  const wrong = instrumentsResult({ version: "0.3.6", reg: listed, state: { ok: true, file: "/x/y" } });
  assert.equal(wrong.status, "FAIL");
  assert.match(wrong.detail, /found tinysoundfont 0\.3\.6, expected 0\.3\.7/);
  const none = instrumentsResult({ version: "0.3.7", reg: { default: null, fonts: {} }, state: null });
  assert.equal(none.status, "FAIL");
  assert.equal(none.detail, "no SoundFont is installed");
  assert.equal(none.fix, SOUNDFONT_FIX);
  assert.match(none.fix, /setup --soundfont/);
  assert.match(none.fix, /https:\/\/ftp\.osuosl\.org\/pub\/musescore\/soundfont\/MuseScore_General\/MuseScore_General\.sf3/);
  const differs = instrumentsResult({ version: "0.3.7", reg: listed, state: { ok: false, reason: "MuseScore_General.sf3 sha256 differs from fonts.json" } });
  assert.equal(differs.status, "FAIL");
  assert.match(differs.detail, /musescore-lite cannot be used \(MuseScore_General\.sf3 sha256 differs from fonts\.json\)/);
  assert.equal(differs.fix, SOUNDFONT_FIX);
  const missing = instrumentsResult({ version: "0.3.7", reg: listed, state: { ok: false, reason: "MuseScore_General.sf3 is missing from /h/soundfonts" } });
  assert.equal(missing.fix, SOUNDFONT_FIX);
});

async function doctorLines(home) {
  const { runDoctor } = await lib("doctor.mjs");
  const lines = [];
  await runDoctor({ home, full: false, log: (l) => lines.push(l) });
  return lines.filter((l) => /^(PASS|WARN|FAIL) instruments:/.test(l));
}

async function installedHome({ version = "0.3.7", fonts = true } = {}) {
  const { saveEnv } = await lib("env.mjs");
  const { writeFonts } = await lib("setup.mjs");
  const { sha256File } = await lib("run.mjs");
  const home = scratch();
  saveEnv(envFor(home, fakePython(home, { version })));
  if (fonts) {
    const dir = path.join(home, "soundfonts");
    fs.mkdirSync(dir, { recursive: true });
    const file = fontFile(dir, "Mine.sf2", "SOUNDFONT mine");
    writeFonts(home, { default: "mine", fonts: { mine: { file: "Mine.sf2", sha256: await sha256File(file), source: "x" } } });
  }
  return home;
}

test("doctor (whole command): the instruments line is PASS when the font is there and matches", unix, async () => {
  const home = await installedHome();
  const lines = await doctorLines(home);
  assert.deepEqual(lines, ["PASS instruments: tinysoundfont 0.3.7, default font mine (Mine.sf2, sha256 matches)"]);
});

test("doctor (whole command): tinysoundfont that does not import is a FAIL that says run setup again", unix, async () => {
  const home = await installedHome({ version: null });
  const [line] = await doctorLines(home);
  assert.match(line, /^FAIL instruments: tinysoundfont is not usable \(.*No module named tinysoundfont\)\. Fix: run setup again$/);
});

test("doctor (whole command): no fonts.json is a FAIL with the SoundFont fix", unix, async () => {
  const { SOUNDFONT_FIX } = await lib("setup.mjs");
  const home = await installedHome({ fonts: false });
  const [line] = await doctorLines(home);
  assert.equal(line, `FAIL instruments: no SoundFont is installed. Fix: ${SOUNDFONT_FIX}`);
});

test("doctor (whole command): a font file that changed after setup is a FAIL, and renaming it away is one too", unix, async () => {
  const home = await installedHome();
  const file = path.join(home, "soundfonts", "Mine.sf2");
  fs.appendFileSync(file, "one more byte");
  const [differs] = await doctorLines(home);
  assert.match(differs, /^FAIL instruments: the default font mine cannot be used \(Mine\.sf2 sha256 differs from fonts\.json\)\. Fix: run setup --soundfont/);
  fs.renameSync(file, `${file}.away`);
  const [missing] = await doctorLines(home);
  assert.match(missing, /^FAIL instruments: the default font mine cannot be used \(Mine\.sf2 is missing from /);
  fs.renameSync(`${file}.away`, file);
  fs.writeFileSync(file, "SOUNDFONT mine");
  assert.match((await doctorLines(home))[0], /^PASS instruments/, "put back, it passes again");
});

// ---------------------------------------------------------------- studio sounds and the help

function studio(args, home) {
  return spawnSync(process.execPath, [STUDIO, ...args], { encoding: "utf8", env: { ...process.env, SYNERGY_STUDIO_HOME: home } });
}

test("studio sounds runs instruments.py list on the home's soundfonts and passes its output through", unix, async () => {
  const home = await installedHome();
  const r = studio(["sounds"], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ARGS: .*instruments\.py list --soundfonts .*soundfonts$/m);
  assert.ok(r.stdout.includes(path.join(home, "soundfonts")));
  assert.match(r.stdout, /musescore-lite: MuseScore_General\.sf3/);
  const named = studio(["sounds", "--font", "fluidr3"], home);
  assert.match(named.stdout, /list --soundfonts .*soundfonts --font fluidr3$/m);
});

test("studio sounds: bad arguments and a failing listing exit 1 with a plain ERROR", unix, async () => {
  const home = await installedHome();
  const bad = studio(["sounds", "--bogus"], home);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^ERROR: sounds does not know "--bogus"/);
  const noValue = studio(["sounds", "--font"], home);
  assert.equal(noValue.status, 1);
  assert.match(noValue.stderr, /--font needs a font id/);
  const failing = scratch();
  const { saveEnv } = await lib("env.mjs");
  const python = path.join(failing, "venv", "bin", "python");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, '#!/bin/sh\necho "ERROR: no SoundFont is installed, so the score cannot be played: run studio setup" >&2\nexit 1\n', { mode: 0o755 });
  saveEnv(envFor(failing, python));
  const r = studio(["sounds"], failing);
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), "ERROR: no SoundFont is installed, so the score cannot be played: run studio setup");
  assert.equal(r.stdout, "");
});

test("studio help lists sounds and the new score line; sounds exports its USAGE", async () => {
  const r = spawnSync(process.execPath, [STUDIO, "help"], { encoding: "utf8" });
  assert.match(r.stdout, /^  sounds \[--font f\]          the installed SoundFont's programs and drum kits, to check names before writing src\/score\.json$/m);
  assert.match(r.stdout, /^  score <dir>               validates and renders src\/score\.json \(real instruments, locked to cues; prints the report\); without that file, film: the bundled starter score → src\/assets\/score\.wav$/m);
  assert.match(r.stdout, /setup \[--whisper-model f\] \[--soundfont id\|file\]/);
  assert.equal((await lib("sounds.mjs")).USAGE, "sounds [--font f]");
});

test("a different file named like a downloadable font does not take its id", async () => {
  const { fontIdFor } = await lib("setup.mjs");
  assert.equal(fontIdFor({ sha256: "0".repeat(64), fileName: "fluidr3.sf2" }), "fluidr3-file");
  assert.equal(fontIdFor({ sha256: "0".repeat(64), fileName: "MuseScore-Lite.sf3" }), "musescore-lite-file");
  assert.equal(fontIdFor({ sha256: "0".repeat(64), fileName: "My Font.sf2" }), "my-font");
});
