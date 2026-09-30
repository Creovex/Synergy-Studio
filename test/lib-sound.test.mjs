// Sound side of the studio: voice ids, say, words, loudness. The refusals run against a fake tool home whose
// python only leaves a marker file, so "before the model loads" is observable. The end to end test uses the
// real tool home when it is installed and is skipped otherwise.
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
const TEN = ["af_heart", "af_bella", "af_nova", "af_sky", "am_michael", "am_adam", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"];
const made = [];
const scratch = (label = "sound") => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `studio ${label} `)); made.push(d); return d; };
test.after(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// a tool home whose python is a script that only writes a marker file
function fakeHome() {
  const home = scratch("fake home");
  const marker = path.join(home, "python-was-run");
  const py = path.join(home, "fake-python.sh");
  fs.writeFileSync(py, `#!/bin/sh\ntouch "${marker}"\nexit 0\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(home, "env.json"), JSON.stringify({ home, node: process.execPath, python: py, ffmpeg: "ffmpeg", ffprobe: "ffprobe", bin: home }));
  return { home, marker };
}
function project(cfg) {
  const dir = scratch("project");
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(cfg));
  return dir;
}
const studio = (home, args) => spawnSync(process.execPath, [STUDIO, ...args], { encoding: "utf8", env: { ...process.env, SYNERGY_STUDIO_HOME: home } });

test("the voice list holds exactly the ten ids and matches voice.py", async () => {
  const { VOICES } = await lib("voice.mjs");
  assert.deepEqual(VOICES, TEN);
  const py = fs.readFileSync(path.join(SCRIPTS, "voice.py"), "utf8");
  const listed = py.match(/^VOICES = \[(.*)\]$/m)[1].split(",").map((x) => x.trim().replace(/"/g, ""));
  assert.deepEqual(listed, TEN);
});

test("projectVoiceProblem names the project voice or the scene", async () => {
  const { projectVoiceProblem } = await lib("voice.mjs");
  assert.equal(projectVoiceProblem({ scenes: [{ id: "s1" }] }), null);
  assert.equal(projectVoiceProblem({ voice: "bf_emma", scenes: [{ id: "s1", voice: "am_adam" }] }), null);
  assert.match(projectVoiceProblem({ voice: "nobody", scenes: [] }), /unknown voice "nobody" \(project voice\)/);
  assert.match(projectVoiceProblem({ voice: "af_heart", scenes: [{ id: "s3", voice: "af_x" }] }), /\(scene s3\)/);
  assert.ok(TEN.every((id) => projectVoiceProblem({ voice: id }) === null));
});

test("voice refuses an unknown project voice before python starts", () => {
  const { home, marker } = fakeHome();
  const dir = project({ voice: "nobody", scenes: [{ id: "s1", say: "hi" }] });
  const r = studio(home, ["voice", dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown voice "nobody" \(project voice\)/);
  for (const id of TEN) assert.ok(r.stderr.includes(id), id);
  assert.equal(fs.existsSync(marker), false);
});

test("voice refuses an unknown scene voice before python starts", () => {
  const { home, marker } = fakeHome();
  const dir = project({ scenes: [{ id: "s1", say: "hi" }, { id: "s2", say: "hi", voice: "am_bogus" }] });
  const r = studio(home, ["voice", dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /"am_bogus" \(scene s2\)/);
  assert.equal(fs.existsSync(marker), false);
});

test("voice with valid ids goes on to python", () => {
  const { home, marker } = fakeHome();
  const dir = project({ voice: "bm_lewis", scenes: [{ id: "s1", say: "hi", voice: "af_sky" }] });
  const r = studio(home, ["voice", dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(marker), true);
});

test("say refuses an unknown --voice, a bare --voice and an unknown project voice before python starts", () => {
  const { home, marker } = fakeHome();
  const dir = project({ voice: "af_heart", scenes: [] });
  const r = studio(home, ["say", dir, "hi", "--voice", "nobody"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown voice "nobody" \(--voice\)/);
  for (const id of TEN) assert.ok(r.stderr.includes(id), id);
  const bare = studio(home, ["say", dir, "hi", "--voice"]);
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /--voice needs a voice id/);
  const badProject = studio(home, ["say", project({ voice: "zz_top", scenes: [] }), "hi"]);
  assert.equal(badProject.status, 1);
  assert.match(badProject.stderr, /\(project voice\)/);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(path.join(dir, "audio")), false);            // nothing was written either
});

test("words keeps the script as written: a lexicon spelling never reaches the captions", () => {
  const dir = project({ lexicon: { HAURA: "Hora" }, scenes: [{ id: "s1", say: "HAURA smells good" }] });
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify({ T: { s1: { start: 0, vo: 1, vo_end: 3, end: 4, dur: 4 } } }));
  const r = studio(scratch("unused home"), ["words", dir]);
  assert.equal(r.status, 0, r.stderr);
  const words = JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf8"));
  assert.deepEqual(words.map((w) => w.text), ["HAURA", "smells", "good"]);
  assert.equal(words[0].start, 1);
  assert.ok(Math.abs(words.at(-1).end - 3) < 0.002);
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].end - 0.002);   // contiguous, character proportional
  assert.ok(words[1].end - words[1].start > words[0].end - words[0].start);                      // "smells" (6) is longer than "HAURA" (5)
});

test("words refuses a footage project and a missing timing.json", () => {
  const home = scratch("unused home");
  const footage = studio(home, ["words", project({ mode: "footage", scenes: [] })]);
  assert.equal(footage.status, 1);
  assert.match(footage.stderr, /footage/);
  const none = studio(home, ["words", project({ scenes: [{ id: "s1", say: "hi" }] })]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no timing\.json/);
});

test("loudnorm measurement is read from ffmpeg output and fed back for a linear second pass", async () => {
  const { parseLoudnorm, loudnormPass2, TARGET } = await lib("audio.mjs");
  const stderr = `[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-20.71",\n\t"input_tp" : "-4.12",\n\t"input_lra" : "5.60",\n\t"input_thresh" : "-31.20",\n\t"output_i" : "-14.11",\n\t"output_tp" : "-1.60",\n\t"output_lra" : "4.90",\n\t"output_thresh" : "-24.60",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "0.11"\n}\n`;
  const m = parseLoudnorm(stderr);
  assert.deepEqual(m, { i: -20.71, tp: -4.12, lra: 5.6, thresh: -31.2, offset: 0.11 });
  const f = loudnormPass2(m);
  assert.match(f, /measured_I=-20.71:measured_TP=-4.12:measured_LRA=5.6:measured_thresh=-31.2:offset=0.11:linear=true/);
  assert.match(f, new RegExp(`I=${TARGET.I}:TP=${TARGET.TP}`));
  assert.ok(TARGET.TP <= -1.5);
  assert.equal(parseLoudnorm("no json here"), null);
  assert.equal(parseLoudnorm('{"input_i" : "-inf", "input_tp": "-inf", "input_lra": "0", "input_thresh": "-70", "target_offset": "0"}'), null);
});

// ---------------------------------------------------------------- plain messages for bad input
const oneLine = (r, ...needles) => {
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^ERROR: /);
  assert.ok(!/at .*\.(mjs|py)|Traceback|SyntaxError:/.test(r.stderr.replace(/\(.*\)/, "")), r.stderr);
  assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
  for (const n of needles) assert.ok(r.stderr.includes(n), `${n} in ${r.stderr}`);
};

test("project.json that is not JSON gives one plain line from voice, say, audio and words", () => {
  const { home, marker } = fakeHome();
  const dir = scratch("broken");
  fs.writeFileSync(path.join(dir, "project.json"), '{"voice": "af_heart", "scenes": [,]}');
  for (const args of [["voice", dir], ["say", dir, "hi"], ["audio", dir], ["words", dir]]) {
    oneLine(studio(home, args), "project.json is not valid JSON", "Fix the file");
  }
  assert.equal(fs.existsSync(marker), false);
});

test("audio refuses an unknown music mood and lists the choices", () => {
  const { home, marker } = fakeHome();
  const r = studio(home, ["audio", project({ music: "jazz", scenes: [{ id: "s1" }] })]);
  oneLine(r, '"jazz"', "warm", "calm", "upbeat", "none", "gain_db");
  assert.equal(fs.existsSync(marker), false);
});

test("voice and say refuse a speed outside 0.5 to 2.0, naming project or scene", () => {
  const { home, marker } = fakeHome();
  oneLine(studio(home, ["voice", project({ speed: 2.5, scenes: [{ id: "s1", say: "hi" }] })]), "(project)", "0.5 to 2.0");
  oneLine(studio(home, ["voice", project({ scenes: [{ id: "s1", say: "hi" }, { id: "s2", say: "hi", speed: 0.2 }] })]), "(scene s2)");
  oneLine(studio(home, ["say", project({ speed: "fast", scenes: [] }), "hi"]), "(project)");
  assert.equal(fs.existsSync(marker), false);
  const ok = studio(home, ["voice", project({ speed: 0.6, scenes: [{ id: "s1", say: "hi" }] })]);     // only a warning (voice.py prints it)
  assert.equal(ok.status, 0, ok.stderr);
});

test("audio on a footage project without audio/voice.wav says to run cut", () => {
  const { home, marker } = fakeHome();
  const dir = project({ mode: "footage", scenes: [{ id: "s1", start: 0, end: 2 }] });
  oneLine(studio(home, ["audio", dir]), "audio/voice.wav is missing", "cut", '"voice_track": false');
  assert.equal(fs.existsSync(marker), false);
  const off = studio(home, ["audio", project({ mode: "footage", voice_track: false, scenes: [{ id: "s1", start: 0, end: 2 }] })]);
  assert.ok(!/voice\.wav is missing/.test(off.stderr));
});

test("voice --only without ids says what it needs", () => {
  const { home, marker } = fakeHome();
  const dir = project({ scenes: [{ id: "s1", say: "hi" }] });
  oneLine(studio(home, ["voice", dir, "--only"]), "--only needs scene ids", "--only s2,s4");
  assert.equal(fs.existsSync(marker), false);
});

test("voice and audio refuse scene ids that do not match s1, s2 or repeat", () => {
  const { home, marker } = fakeHome();
  for (const cmd of ["voice", "audio"]) {
    oneLine(studio(home, [cmd, project({ scenes: [{ id: "intro", say: "hi" }] })]), '"intro"', "s1, s2");
    oneLine(studio(home, [cmd, project({ scenes: [{ id: "s1", say: "a" }, { id: "s1", say: "b" }] })]), '"s1" is used twice');
    oneLine(studio(home, [cmd, project({ scenes: [{ id: "s1" }, { say: "no id" }] })]), "not allowed");
  }
  assert.equal(fs.existsSync(marker), false);
});

// ---------------------------------------------------------------- the real tool home
const realHome = process.env.SYNERGY_STUDIO_HOME || path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite");
const installed = fs.existsSync(path.join(realHome, "env.json"));
const measure = (ffmpeg, file) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const summary = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  return { lufs: Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)[1]), peak: Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)[1]) };
};

test("end to end: narrated pipeline is repeatable, loud enough and under the peak limit; say and en-gb work", { skip: !installed && "tool home not installed", timeout: 240000 }, () => {
  const env = JSON.parse(fs.readFileSync(path.join(realHome, "env.json"), "utf8"));
  const cfg = { name: "sound-test", aspect: "9:16", voice: "bf_emma", speed: 1.0, music: "warm", lexicon: { HAURA: "Hora" },
    events: { s1: { a: { t: 0.6, sfx: "pop" } } }, scenes: [{ id: "s1", say: "HAURA smells like a quiet morning." }, { id: "s2", say: "Try it today.", voice: "am_michael" }] };
  const a = project(cfg), b = project(cfg);
  const v = spawnSync(process.execPath, [STUDIO, "voice", a], { encoding: "utf8" });
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /voice bf_emma, language en-gb/);
  assert.match(v.stdout, /s2: .*\[voice am_michael, en-us\]/);
  fs.cpSync(path.join(a, "audio"), path.join(b, "audio"), { recursive: true });
  fs.copyFileSync(path.join(a, "durations.json"), path.join(b, "durations.json"));
  for (const d of [a, b]) { const r = spawnSync(process.execPath, [STUDIO, "audio", d], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); }
  assert.ok(fs.readFileSync(path.join(a, "audio", "mix.wav")).equals(fs.readFileSync(path.join(b, "audio", "mix.wav"))), "the same project gives the same mix");
  const t = JSON.parse(fs.readFileSync(path.join(a, "timing.json"), "utf8"));
  assert.equal(t.T.s1.vo, 0.4);                                                   // 9:16 default lead
  const m = measure(env.ffmpeg, path.join(a, "audio", "mix.wav"));
  assert.ok(Math.abs(m.lufs + 14) <= 0.5, `integrated ${m.lufs}`);
  assert.ok(m.peak <= -1.5, `true peak ${m.peak}`);

  const s = spawnSync(process.execPath, [STUDIO, "say", a, "HAURA"], { encoding: "utf8" });
  assert.equal(s.status, 0, s.stderr);
  assert.ok(fs.statSync(path.join(a, "audio", "say.wav")).size > 1000);
  assert.equal(fs.existsSync(path.join(a, "audio", "say-project")), false);
});

test("end to end: a film project mixes to the loudness band", { skip: !installed && "tool home not installed", timeout: 120000 }, () => {
  const env = JSON.parse(fs.readFileSync(path.join(realHome, "env.json"), "utf8"));
  const dir = project({ mode: "film", music: "calm", scenes: [{ id: "s1", start: 0, end: 5 }, { id: "s2", start: 5, end: 10 }] });
  const r = spawnSync(process.execPath, [STUDIO, "audio", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const m = measure(env.ffmpeg, path.join(dir, "audio", "mix.wav"));
  assert.ok(Math.abs(m.lufs + 14) <= 0.5, `integrated ${m.lufs}`);
  assert.ok(m.peak <= -1.5, `true peak ${m.peak}`);
});
