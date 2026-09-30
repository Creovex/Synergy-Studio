// Footage and checking side of the studio: import, cut (crop_x, the sync warning), transcribe and the added `check` lines.
// The pure helpers run anywhere; the command tests use the real tool home when it is installed and are skipped otherwise.
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
const HOME = process.env.SYNERGY_STUDIO_HOME || (process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite") : path.join(os.homedir(), ".local", "share", "synergy-studio-lite"));
const ENV = (() => { try { return JSON.parse(fs.readFileSync(path.join(HOME, "env.json"), "utf8")); } catch { return null; } })();
const installed = !!ENV && fs.existsSync(ENV.ffmpeg);
const skipReal = installed ? false : "the tool home is not installed";
const made = [];
const scratch = (label) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `studio ${label} `)); made.push(d); return d; };
test.after(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const studio = (args, home = HOME) => spawnSync(process.execPath, [STUDIO, ...args], { encoding: "utf8", env: { ...process.env, SYNERGY_STUDIO_HOME: home } });
const ff = (args) => { const r = spawnSync(ENV.ffmpeg, ["-v", "error", "-y", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
const project = (dir, cfg) => fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(cfg));
const noStack = (text) => assert.doesNotMatch(text, /\n\s+at .*\(|node:internal|Error: /);

// ---------------------------------------------------------------- pure helpers
test("crop_x: 0 to 1 is accepted, anything else is a plain error naming the clip", async () => {
  const { cropXProblem } = await lib("cut.mjs");
  assert.equal(cropXProblem([{}, { crop_x: 0 }, { crop_x: 0.5 }, { crop_x: 1 }]), null);
  assert.match(cropXProblem([{}, { crop_x: 1.2 }]), /edit\.clips\[1\]\.crop_x is 1\.2; use a number from 0/);
  assert.match(cropXProblem([{ crop_x: -0.1 }]), /clips\[0\]\.crop_x is -0\.1/);
  assert.match(cropXProblem([{ crop_x: "left" }]), /"left"/);
  assert.match(cropXProblem([{ crop_x: null }]), /null/);
});

test("sync warning: more than one frame apart warns with the ffmpeg command, a clean clip does not", async () => {
  const { syncWarning } = await lib("cut.mjs");
  assert.equal(syncWarning("/a/c.mp4", { audio: 0, video: 0 }, 30), null);
  assert.equal(syncWarning("/a/c.mp4", { audio: 0.03, video: 0 }, 30), null);            // under one frame at 30 fps
  assert.equal(syncWarning("/a/c.mp4", { audio: null, video: 0 }, 30), null);            // no audio at all
  const w = syncWarning("/a/my clip.mp4", { audio: 0.2, video: 0 }, 30, "src/footage/my clip.mp4");
  assert.match(w, /the audio starts 0\.200 s after the picture/);
  assert.match(w, /ffmpeg -i '\/a\/my clip\.mp4' -itsoffset -0\.2 -i '\/a\/my clip\.mp4' -map 0:v -map 1:a -c copy '\/a\/my clip-synced\.mp4'/);
  assert.match(syncWarning("/a/c.mp4", { audio: 0, video: 0.1 }, 30), /before the picture/);
  assert.equal(syncWarning("/a/c.mp4", { audio: 0.04, video: 0 }, 24), null);            // 40 ms is one frame at 24 fps
  assert.ok(syncWarning("/a/c.mp4", { audio: 0.04, video: 0 }, 60));
});

test("toWords keeps text, start and end and splits a phrase by word length", async () => {
  const { toWords } = await lib("transcribe.mjs");
  const w = toWords([{ id: "w0", text: "Hello", start: 0.1234, end: 0.5 }, { id: "w1", text: "a bc", start: 1, end: 2 }, { text: "  ", start: 3, end: 4 }, { text: "x", start: NaN, end: 1 }]);
  assert.deepEqual(w.map((x) => x.text), ["Hello", "a", "bc"]);
  assert.deepEqual(Object.keys(w[0]), ["text", "start", "end"]);
  assert.equal(w[0].start, 0.123);
  assert.equal(w[1].start, 1); assert.equal(w[2].end, 2);
  assert.ok(w[1].end > 1 && w[1].end < w[2].end);
});

test("pageRoot reads size, fps and duration from the root element", async () => {
  const { pageRoot } = await lib("check.mjs");
  const html = '<body><div id="root" data-composition-id="main" data-width="1080" data-height="1920" data-fps="30" data-duration="13.5"></div></body>';
  assert.deepEqual(pageRoot(html), { duration: 13.5, width: 1080, height: 1920, fps: 30 });
  assert.equal(pageRoot("<div></div>").duration, null);
});

test("captionsCall finds a real call, not a comment or the destructuring", async () => {
  const { captionsCall } = await lib("check.mjs");
  assert.equal(captionsCall("const {tl, captions, finish} = SS.start();\n// captions({top: 1});\n/* captions() */\n<!-- captions() -->"), null);
  assert.ok(captionsCall("  captions({top: '70%', size: 76});"));
  const c = captionsCall("SS.start(); captions({from: 4.7, to: 13, highlight: \"#fff\"}); x()");
  assert.equal(c.from, 4.7); assert.equal(c.to, 13);
  assert.equal(captionsCall("captions();").from, null);
});

test("compareCaptions reports missing words and the earliest highlight", async () => {
  const { compareCaptions } = await lib("check.mjs");
  const exp = [{ text: "one", start: 1 }, { text: "two", start: 2 }, { text: "three", start: 3 }];
  const rec = (t) => [{ words: [{ text: "one", start: 1 }, { text: "two", start: t }] }, { words: [{ text: "three", start: 3 }] }];
  assert.deepEqual(compareCaptions(exp, rec(2)), { missing: [], maxEarly: 0 });
  assert.equal(compareCaptions(exp, rec(1.8)).maxEarly.toFixed(2), "0.20");
  const half = compareCaptions(exp, [{ words: [{ text: "one", start: 1 }] }]);
  assert.deepEqual(half.missing.map((w) => w.text), ["two", "three"]);
  assert.equal(compareCaptions(exp, []).missing.length, 3);
});

test("insideProject refuses a path that leaves the folder", async () => {
  const { insideProject } = await lib("check.mjs");
  assert.equal(insideProject("/p/x", "audio/mix.wav"), path.resolve("/p/x/audio/mix.wav"));
  assert.equal(insideProject("/p/x", "../y/mix.wav"), null);
  assert.equal(insideProject("/p/x", "/etc/passwd"), null);
});

// ---------------------------------------------------------------- import and cut
// a 1280x720 clip: left half red, right half blue, with a tone
function twoColourClip(file, { audioDelay = 0 } = {}) {
  const args = ["-f", "lavfi", "-i", "color=c=red:s=640x720:r=30:d=4", "-f", "lavfi", "-i", "color=c=blue:s=640x720:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4",
    ...(audioDelay ? ["-itsoffset", String(audioDelay), "-f", "lavfi", "-i", "sine=f=440:d=4"] : []),
    "-filter_complex", "[0][1]hstack[v]", "-map", "[v]", "-map", audioDelay ? "3:a" : "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file];
  ff(args);
}
// mean colour of the middle of a frame at t: [r, g, b]
function pixel(file, t) {
  const r = spawnSync(ENV.ffmpeg, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "crop=8:8:(iw-8)/2:(ih-8)/2,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...r.stdout];
}

test("import makes a footage project with one clip over the whole file and a source sheet", { skip: skipReal }, async () => {
  const dir = scratch("import"), clip = path.join(dir, "in.mp4"), proj = path.join(dir, "proj");
  twoColourClip(clip);
  const { main } = await lib("import.mjs");
  const lines = []; const log = console.log; console.log = (m) => lines.push(m);
  try { process.env.SYNERGY_STUDIO_HOME = HOME; await main([proj, clip]); } finally { console.log = log; }
  const j = JSON.parse(fs.readFileSync(path.join(proj, "project.json"), "utf8"));
  assert.equal(j.mode, "footage"); assert.equal(j.aspect, "9:16");
  assert.equal(j.edit.clips.length, 1);
  assert.deepEqual([j.edit.clips[0].src, j.edit.clips[0].in], ["src/footage/in.mp4", 0]);
  assert.ok(Math.abs(j.edit.clips[0].out - 4) < 0.1);
  assert.ok(fs.existsSync(path.join(proj, "src", "footage", "in.mp4")));
  assert.ok(fs.statSync(path.join(proj, "stills", "source-sheet.jpg")).size > 1000);
  assert.match(lines.join("\n"), /4\.\d+ s, 30 fps, 1280x720, with audio \(aac\)/);
});

test("import refuses a non video and a bad aspect in plain words", { skip: skipReal }, async () => {
  const dir = scratch("import bad"), txt = path.join(dir, "a.txt"); fs.writeFileSync(txt, "hello");
  const run = (args) => spawnSync(process.execPath, ["-e", `import(${JSON.stringify(pathToFileURL(path.join(SCRIPTS, "lib", "import.mjs")).href)}).then(m=>m.main(process.argv.slice(1)))`, ...args], { encoding: "utf8", env: { ...process.env, SYNERGY_STUDIO_HOME: HOME } });
  const a = run([path.join(dir, "p"), txt]); assert.equal(a.status, 1); assert.match(a.stderr, /not a video file/); noStack(a.stderr);
  const b = run([path.join(dir, "p"), txt, "--aspect", "3:2"]); assert.equal(b.status, 1); assert.match(b.stderr, /--aspect must be one of/);
});

test("cut places the crop at crop_x and rejects a value outside 0 to 1", { skip: skipReal }, () => {
  const dir = scratch("cut crop"); fs.mkdirSync(path.join(dir, "src", "footage"), { recursive: true });
  twoColourClip(path.join(dir, "src", "footage", "c.mp4"));
  const cfg = (x) => ({ name: "t", mode: "footage", aspect: "9:16", fps: 30, edit: { grade: "none", clean_voice: false, clips: [{ src: "src/footage/c.mp4", in: 0, out: 2, crop_x: x[0] }, { src: "src/footage/c.mp4", in: 0, out: 2, crop_x: x[1] }] } });
  project(dir, cfg([1.5, 0]));
  const bad = studio(["cut", dir]); assert.equal(bad.status, 1); assert.match(bad.stderr, /crop_x is 1\.5/); noStack(bad.stderr);
  project(dir, cfg([0, 1]));
  const ok = studio(["cut", dir]); assert.equal(ok.status, 0, ok.stderr);
  const base = path.join(dir, "src", "assets", "base.mp4");
  const [r0, , b0] = pixel(base, 0.5), [r1, , b1] = pixel(base, 2.5);
  assert.ok(r0 > 200 && b0 < 60, `first part sits on the red left side: ${r0},${b0}`);
  assert.ok(b1 > 200 && r1 < 60, `second part sits on the blue right side: ${r1},${b1}`);
  project(dir, cfg([undefined, undefined]));                                              // no crop_x: the centre, as before
  assert.equal(studio(["cut", dir]).status, 0);
});

test("cut warns when the audio starts late and stays quiet for a clean clip", { skip: skipReal }, () => {
  const dir = scratch("cut sync"); fs.mkdirSync(path.join(dir, "src", "footage"), { recursive: true });
  twoColourClip(path.join(dir, "src", "footage", "late.mp4"), { audioDelay: 0.3 });
  twoColourClip(path.join(dir, "src", "footage", "clean.mp4"));
  const cfg = (name) => ({ name: "t", mode: "footage", aspect: "9:16", fps: 30, edit: { grade: "none", clean_voice: false, clips: [{ src: `src/footage/${name}.mp4`, in: 0, out: 2 }] } });
  project(dir, cfg("late"));
  const late = studio(["cut", dir]); assert.equal(late.status, 0, late.stderr);
  assert.match(late.stdout, /warning: src\/footage\/late\.mp4: the audio starts 0\.\d+ s after the picture/);
  assert.match(late.stdout, /-itsoffset -0\.\d+ -i .*late\.mp4.* -map 0:v -map 1:a -c copy/);
  project(dir, cfg("clean"));
  const clean = studio(["cut", dir]); assert.equal(clean.status, 0, clean.stderr);
  assert.doesNotMatch(clean.stdout, /warning/);
});

// ---------------------------------------------------------------- transcribe
function wav(file, seconds, hz) {
  const args = seconds === 0 ? ["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "0"] : ["-f", "lavfi", "-i", hz ? `sine=f=${hz}:d=${seconds}` : `anullsrc=r=16000:cl=mono`, "-t", String(seconds)];
  ff([...args, "-ar", "16000", "-ac", "1", file]);
}

test("transcribe gives a plain error for an empty, zero byte or silent file", { skip: skipReal || (ENV?.whisper?.available ? false : "whisper is not installed") }, () => {
  const dir = scratch("transcribe"); project(dir, { name: "t", mode: "footage" });
  const empty = path.join(dir, "empty.wav"), silent = path.join(dir, "silent.wav"), zero = path.join(dir, "zero.wav");
  wav(empty, 0); wav(silent, 2); fs.writeFileSync(zero, "");
  for (const [f, re] of [[empty, /no sound in it/], [silent, /is silent/], [zero, /empty file/]]) {
    const r = studio(["transcribe", dir, f]); assert.equal(r.status, 1, f); assert.match(r.stderr, re); noStack(r.stderr);
  }
  assert.ok(!fs.existsSync(path.join(dir, "transcript.json")));
});

test("transcribe stops with the fix when whisper is not installed, but still imports a caption file", { skip: skipReal }, () => {
  const home = scratch("fake home");
  fs.writeFileSync(path.join(home, "env.json"), JSON.stringify({ ...ENV, home, whisper: { available: false, reason: "no compiler" } }));
  const dir = scratch("transcribe none"); project(dir, { name: "t", mode: "footage" });
  const a = path.join(dir, "a.wav"); wav(a, 1, 300);
  const r = studio(["transcribe", dir, a], home);
  assert.equal(r.status, 1); assert.match(r.stderr, /the whisper-cli program is missing/); assert.match(r.stderr, /setup/); assert.match(r.stderr, /studio doctor shows what captions need/); assert.doesNotMatch(r.stderr, /brew/i); noStack(r.stderr);
  const srt = path.join(dir, "c.srt"); fs.writeFileSync(srt, "1\n00:00:00,500 --> 00:00:02,000\nHello there\n");
  const i = studio(["transcribe", dir, srt], home);
  assert.equal(i.status, 0, i.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf8")).length, 1);
});

// ---------------------------------------------------------------- check
test("check on a plain HyperFrames folder compares the duration with data-duration and skips the mix and captions lines", { skip: skipReal }, () => {
  const dir = scratch("check hf"); fs.mkdirSync(path.join(dir, "out"));
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ kind: "hyperframes", name: "x" }));
  fs.writeFileSync(path.join(dir, "index.html"), '<div id="root" data-composition-id="main" data-width="640" data-height="360" data-duration="3"></div>');
  ff(["-f", "lavfi", "-i", "testsrc=s=640x360:r=30:d=3", "-f", "lavfi", "-i", "sine=f=440:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "out", "x.mp4")]);
  const r = studio(["check", dir]);
  assert.match(r.stdout, /PASS {2}duration: 3\.\d+ s \(data-duration 3 s/);
  assert.match(r.stdout, /PASS {2}frame rate: 30 fps/);
  assert.doesNotMatch(r.stdout, /audio against mix|captions/);
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ kind: "hyperframes", name: "x", mix: "../elsewhere.wav" }));
  const bad = studio(["check", dir]);
  assert.equal(bad.status, 2); assert.match(bad.stdout, /FAIL {2}audio against mix: \.\.\/elsewhere\.wav is not inside the project folder/);
});

// ---------------------------------------------------------------- cut: exact trims and clear errors
test("trimProblem names the clip when out is not after in or a field is missing", async () => {
  const { trimProblem, clipFrames } = await lib("cut.mjs");
  assert.equal(trimProblem([{ src: "a.mp4", in: 0, out: 2 }, { src: "a.mp4", in: 1.5, out: 3 }]), null);
  assert.match(trimProblem([{ src: "a.mp4", in: 0, out: 2 }, { src: "b.mp4", in: 5, out: 3 }]), /edit\.clips\[1\] \(b\.mp4\): "out" \(3\) must be later than "in" \(5\)/);
  assert.match(trimProblem([{ src: "a.mp4", in: 2, out: 2 }]), /must be later/);
  assert.match(trimProblem([{ src: "a.mp4", in: "1", out: 3 }]), /needs "in" and "out"/);
  assert.match(trimProblem([{ in: 0, out: 3 }]), /clips\[0\] has no "src"/);
  assert.equal(clipFrames({ in: 0, out: 2 }, 30), 60); assert.equal(clipFrames({ in: 0.4, out: 2.9 }, 30), 75);
});

test("cut with in after out is a plain error, not ffmpeg output", { skip: skipReal }, () => {
  const dir = scratch("cut bad"); fs.mkdirSync(path.join(dir, "src", "footage"), { recursive: true });
  twoColourClip(path.join(dir, "src", "footage", "c.mp4"));
  project(dir, { name: "t", mode: "footage", aspect: "9:16", edit: { clips: [{ src: "src/footage/c.mp4", in: 3, out: 1 }] } });
  const r = studio(["cut", dir]); assert.equal(r.status, 1);
  assert.match(r.stderr, /edit\.clips\[0\] \(src\/footage\/c\.mp4\): "out" \(1\) must be later than "in" \(3\)/);
  assert.doesNotMatch(r.stderr, /ffmpeg|Invalid|exited with/i);
});

test("cut gives every clip exactly its frames: picture and sound both equal the sum of the trims, cuts.json matches", { skip: skipReal }, () => {
  const dir = scratch("cut frames"); fs.mkdirSync(path.join(dir, "src", "footage"), { recursive: true });
  ff(["-f", "lavfi", "-i", "testsrc=s=640x360:r=30:d=12", "-f", "lavfi", "-i", "sine=f=300:d=12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, "src", "footage", "c.mp4")]);
  const trims = [[0, 2], [3, 5.5], [6, 8.5], [9, 11.5]];
  project(dir, { name: "t", mode: "footage", aspect: "9:16", fps: 30, edit: { grade: "none", clean_voice: false, clips: trims.map(([i, o]) => ({ src: "src/footage/c.mp4", in: i, out: o })) } });
  const r = studio(["cut", dir]); assert.equal(r.status, 0, r.stderr);
  const probe = (args) => spawnSync(ENV.ffprobe, ["-v", "error", ...args], { encoding: "utf8" }).stdout.trim();
  const frames = +probe(["-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path.join(dir, "src", "assets", "base.mp4")]);
  const voice = +probe(["-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "audio", "voice.wav")]);
  assert.equal(frames, 285, "9.5 s at 30 fps");
  assert.ok(Math.abs(voice - 9.5) <= 1 / 30, `voice.wav is ${voice} s`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "cuts.json"), "utf8")).cuts, [0, 2, 4.5, 7]);
});

// ---------------------------------------------------------------- silences and scenes
test("silences and scenes find a clip relative to the project and refuse bad input plainly", { skip: skipReal }, () => {
  const dir = scratch("silences"); fs.mkdirSync(path.join(dir, "src", "footage"), { recursive: true });
  ff(["-f", "lavfi", "-i", "testsrc=s=320x180:r=30:d=3", "-f", "lavfi", "-i", "sine=f=300:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, "src", "footage", "c.mp4")]);
  project(dir, { name: "t", mode: "footage" });
  const txt = path.join(dir, "note.txt"); fs.writeFileSync(txt, "hello");
  const ok = studio(["silences", dir, "src/footage/c.mp4"]); assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /pauses/);
  const none = studio(["scenes", dir, "src/footage/c.mp4"]); assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /^no shot changes found at threshold 0\.3/); assert.doesNotMatch(none.stdout, /: \n?$/);
  const missing = studio(["silences", dir, "nothere.mp4"]); assert.equal(missing.status, 1); assert.match(missing.stderr, /clip not found: nothere\.mp4 \(looked in .* and .*\)/);
  const badDb = studio(["silences", dir, "src/footage/c.mp4", "--db", "abc"]); assert.equal(badDb.status, 1); assert.match(badDb.stderr, /--db needs a level in dB below zero.*"abc"/);
  const text = studio(["silences", dir, txt]); assert.equal(text.status, 1); assert.match(text.stderr, /has no audio/);
  const textScenes = studio(["scenes", dir, txt]); assert.equal(textScenes.status, 1); assert.match(textScenes.stderr, /has no picture/);
  const badTh = studio(["scenes", dir, "src/footage/c.mp4", "--threshold", "2"]); assert.equal(badTh.status, 1); assert.match(badTh.stderr, /--threshold needs a number between 0 and 1/);
});

// ---------------------------------------------------------------- check: a sound that stops early, a muted file
function checkProject(audioFilter, { mute = false } = {}) {
  const dir = scratch("check audio"); fs.mkdirSync(path.join(dir, "out")); fs.mkdirSync(path.join(dir, "audio"));
  project(dir, { name: "t", aspect: "9:16", fps: 30 });
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify({ TOTAL: 8, T: {} }));
  const tone = "sine=f=330:d=9,tremolo=f=1.5:d=0.95";
  ff(["-f", "lavfi", "-i", tone, "-ar", "48000", "-ac", "1", path.join(dir, "audio", "mix.wav")]);
  ff(["-f", "lavfi", "-i", "testsrc=s=1080x1920:r=30:d=8", "-f", "lavfi", "-i", tone, "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(mute ? ["-an"] : ["-c:a", "aac", "-af", audioFilter]), "-t", "8", path.join(dir, "out", "t-9x16.mp4")]);
  return studio(["check", dir]);
}

test("check fails audio against mix when the sound stops before the picture, and passes when it does not", { skip: skipReal }, () => {
  const good = checkProject("anull"); assert.match(good.stdout, /PASS {2}audio against mix: lag 0 ms/);
  for (const end of [6, 3]) {
    const r = checkProject(`atrim=end=${end}`);
    assert.equal(r.status, 2, `audio ends at ${end} s`);
    assert.match(r.stdout, /FAIL {2}audio against mix: .*the sound in the video ends \d\.\d+ s before the picture does/);
    assert.match(r.stdout, /the last 2 s of the video do not match/);
  }
});

test("check on a muted file says there is no audio stream on each audio line, with no NaN and no ffmpeg text", { skip: skipReal }, () => {
  const r = checkProject("", { mute: true });
  assert.equal(r.status, 2);
  for (const name of ["audio stream", "loudness", "true peak", "audio against mix"]) assert.match(r.stdout, new RegExp(`FAIL {2}${name}: .*(missing|no audio stream)`));
  assert.doesNotMatch(r.stdout + r.stderr, /NaN|Invalid|Error/);
});

// ---------------------------------------------------------------- word onsets from the audio
test("refineWords moves a start that sits in the silence before its word, or late inside it, and leaves continuous speech alone", async () => {
  const { refineWords, FRAME_S } = await lib("wordsnap.mjs");
  const levels = new Float32Array(Math.round(10 / FRAME_S)).fill(-90);
  const sound = (a, b) => { for (let i = Math.round(a / FRAME_S); i < Math.round(b / FRAME_S); i++) levels[i] = -20; };
  sound(1.0, 1.5); sound(3.0, 3.6); sound(6.0, 6.3); sound(6.4, 7.0);        // three separate runs; the last has a 100 ms dip inside a word pair
  const words = [{ text: "one", start: 1.1, end: 1.4 }, { text: "two", start: 1.45, end: 3.2 }, { text: "three", start: 3.25, end: 3.5 }, { text: "four", start: 6.0, end: 6.3 }, { text: "five", start: 6.4, end: 7.0 }];
  const r = refineWords(words, levels), t = (i) => r[i].start;
  assert.ok(Math.abs(t(0) - 1.0) < 0.011, "late inside its word: back to the onset");
  assert.ok(Math.abs(t(1) - 3.0) < 0.011, "placed on the last sliver of the word before: forward to the next sound");
  assert.ok(Math.abs(t(2) - 3.25) < 0.011, "inside the same run as the word before: kept");
  assert.deepEqual(r.map((w) => Object.keys(w)), words.map(() => ["text", "start", "end"]));
  assert.ok(r.every((w, i) => w.end > w.start && (i === 0 || w.start >= r[i - 1].start)));
  const flat = new Float32Array(1000).fill(-20);                              // no silence anywhere: nothing to snap to
  assert.deepEqual(refineWords(words, flat), words);
  const quiet = refineWords([{ text: "a", start: 1.2, end: 1.4 }, { text: "b", start: 1.6, end: 1.7 }], levels);   // starts in a pause but the word's interval ends before the next sound: kept
  assert.equal(quiet[1].start, 1.6);
});

test("transcribe names the missing Whisper model and how to get it, never brew", async () => {
  const { missingPart } = await lib("transcribe.mjs");
  const home = scratch("model"), bin = path.join(home, "whisper-cli"); fs.writeFileSync(bin, "");
  const e = { whisper: { available: true, path: bin }, hf_home: home };
  const m = missingPart(e, "proj");
  assert.match(m, /the Whisper model is missing \(.*ggml-small\.en\.bin\)/);
  assert.match(m, /setup\s+to download it/); assert.match(m, /huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\/ggml-small\.en\.bin/);
  assert.match(m, /setup --whisper-model <that file>/); assert.match(m, /studio transcribe proj subs\.srt/); assert.doesNotMatch(m, /brew/i);
  const dir = path.join(home, ".cache", "hyperframes", "whisper", "models"); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "ggml-small.en.bin"), "");
  assert.equal(missingPart(e, "proj"), "");
  assert.match(missingPart({ ...e, whisper: { available: true, path: path.join(home, "nope") } }, "proj"), /whisper-cli program is missing \(.*nope\)/);
});

test("cutSpans gives the span of every clip from cuts.json", async () => {
  const { cutSpans } = await lib("transcribe.mjs");
  const d = scratch("spans"); assert.equal(cutSpans(d), null);
  fs.writeFileSync(path.join(d, "cuts.json"), JSON.stringify({ total: 12.4, cuts: [0, 7.8] }));
  assert.deepEqual(cutSpans(d), [[0, 7.8], [7.8, 12.4]]);
  fs.writeFileSync(path.join(d, "cuts.json"), "not json"); assert.equal(cutSpans(d), null);
});

// the reference video has speech; a cleaned cut of two clips came back from Whisper as one 13 s word, and a word crossed the cut
const ONESCAN = path.join(ROOT, "reference", "videos", "onescan.mp4");
const modelThere = ENV && fs.existsSync(path.join(ENV.hf_home, ".cache", "hyperframes", "whisper", "models", "ggml-small.en.bin"));
for (const clean of [true, false]) {
  test(`transcribe of a two clip cut with clean_voice ${clean} finds the words clip by clip, none across the cut`, { skip: skipReal || (!fs.existsSync(ONESCAN) ? "reference video missing" : !ENV.whisper?.available || !modelThere ? "whisper model not installed" : false), timeout: 240000 }, () => {
    const dir = scratch("transcribe cut"); fs.mkdirSync(path.join(dir, "src", "footage"), { recursive: true });
    fs.copyFileSync(ONESCAN, path.join(dir, "src", "footage", "clip.mp4"));
    project(dir, { name: "t", mode: "footage", aspect: "9:16", fps: 30, edit: { grade: "warm", clean_voice: clean, clips: [{ src: "src/footage/clip.mp4", in: 16.5, out: 24.3 }, { src: "src/footage/clip.mp4", in: 0.7, out: 5.9 }] } });
    assert.equal(studio(["cut", dir]).status, 0);
    const r = studio(["transcribe", dir]); assert.equal(r.status, 0, r.stderr);
    const words = JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf8")), cut = JSON.parse(fs.readFileSync(path.join(dir, "cuts.json"), "utf8")).cuts[1];
    assert.ok(words.length >= 20, `${words.length} words`);
    assert.ok(words.every((w) => w.end - w.start < 3), "no word runs for seconds");
    assert.ok(words.every((w) => w.end <= cut + 1e-6 || w.start >= cut - 1e-6), "no word crosses the cut");
  });
}
