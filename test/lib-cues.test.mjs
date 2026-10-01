// Tests for the cue sheet: the cues and score commands, CUE in the page, stills --cues and --range, the compose checks,
// the sync line of check. The pure parts need no install; the ones that run the tools are skipped without the tool home.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILL = path.join(ROOT, "skills", "synergy-studio");
const STUDIO = path.join(SKILL, "scripts", "studio.mjs");
const lib = (name) => import(pathToFileURL(path.join(SKILL, "scripts", "lib", name)).href);
const made = [];
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "studio cues test ")); made.push(d); return d; };
const studio = (...args) => spawnSync(process.execPath, [STUDIO, ...args], { encoding: "utf8" });

const homeDir = process.env.SYNERGY_STUDIO_HOME
  || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite")
    : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "SynergyStudioLite")
      : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "synergy-studio-lite"));
const SKIP = fs.existsSync(path.join(homeDir, "env.json")) ? false : "the tool home is not set up (run setup)";

// a film project folder with the given project.json fields
function filmProject(extra = {}) {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "src", "assets"), { recursive: true });
  const proj = { name: "t", mode: "film", aspect: "9:16", length: 8, fps: 30, music: "none", transition_whoosh: false,
    scenes: [{ id: "s1", start: 0, end: 4 }, { id: "s2", start: 4, end: 8 }], ...extra };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(proj));
  return dir;
}

// ---- cues: the sheet in time order
test("cueRows sorts by time, names the scene, the gap and the flags", async () => {
  const { cueRows } = await lib("cues.mjs");
  const { rows, problems } = cueRows({ fps: 30, scenes: [{ id: "s1", start: 0, end: 4 }, { id: "s2", start: 4, end: 8 }],
    cues: { late: 6.5, early: { t: 1.25, sync: true, sfx: "pop" }, mid: 4 } });
  assert.deepEqual(problems, []);
  assert.deepEqual(rows.map((r) => r.name), ["early", "mid", "late"]);
  assert.deepEqual(rows.map((r) => r.scene), ["s1", "s2", "s2"]);
  assert.deepEqual(rows.map((r) => r.gap), [null, 2.75, 2.5]);
  assert.equal(rows[0].sync, true);
  assert.equal(rows[0].sfx, "pop");
  assert.equal(rows[1].sync, false);
});

test("cueRows flags cues under 3 frames apart and only those", async () => {
  const { cueRows, cueLine } = await lib("cues.mjs");
  const { rows } = cueRows({ fps: 30, cues: { a: 1, b: 1.09, c: 1.2 } });   // 0.09 s = 2.7 frames, 0.11 s = 3.3 frames
  assert.deepEqual(rows.map((r) => r.close), [false, true, false]);
  assert.match(cueLine(rows[1]), /! under 3 frames after the previous cue/);
  assert.doesNotMatch(cueLine(rows[2]), /under 3 frames/);
});

test("cueRows reports a cue without a usable time instead of guessing", async () => {
  const { cueRows } = await lib("cues.mjs");
  const { rows, problems } = cueRows({ cues: { ok: 1, text: "soon", none: { sync: true }, neg: -1 } });
  assert.deepEqual(rows.map((r) => r.name), ["ok"]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /cue "text" needs a time in seconds/);
});

test("cueRows takes the scene spans from timing.json for a narrated project", async () => {
  const { cueRows } = await lib("cues.mjs");
  const timing = { T: { s1: { start: 0, end: 5.5 }, s2: { start: 5.5, end: 12 } } };
  const { rows } = cueRows({ scenes: [{ id: "s1", say: "x" }, { id: "s2", say: "y" }], cues: { hit: 7 } }, timing);
  assert.equal(rows[0].scene, "s2");
});

test("studio cues prints the sheet in time order and exits 0; an empty sheet is an error", () => {
  const dir = filmProject({ cues: { bang: { t: 3.5, sync: true }, slam: 1.4 } });
  const r = studio("cues", dir);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split("\n");
  assert.match(lines[0], /^\s+1\.40 s  s1\s+slam$/);
  assert.match(lines[1], /^\s+3\.50 s  s1\s+\+2\.10  bang  \[sync\]$/);
  assert.match(lines[2], /2 cues, 1 checked for sync/);
  const empty = studio("cues", filmProject());
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /no "cues" in project\.json/);
});

// ---- new --mode film
test("new --mode film sets an example cue and copies the starter score", () => {
  const dir = path.join(tmp(), "f");
  const r = studio("new", dir, "--mode", "film", "--length", "10");
  assert.equal(r.status, 0, r.stderr);
  const proj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
  assert.deepEqual(proj.cues, { hit: { t: 5, sync: true } });
  assert.equal(fs.readFileSync(path.join(dir, "scripts", "score.py"), "utf8"), fs.readFileSync(path.join(SKILL, "template", "score.py"), "utf8"));
  assert.match(r.stdout, /studio cues/);
  assert.match(r.stdout, /studio score/);
  const narrated = path.join(tmp(), "n");
  studio("new", narrated);
  assert.equal(fs.existsSync(path.join(narrated, "scripts")), false, "only film projects get a score");
});

// ---- stills: the extra frames
test("cueFrames gives each cue at -4, 0 and +6 frames with a legend", async () => {
  const { cueFrames } = await lib("stills.mjs");
  const { frames, legend } = cueFrames({ fps: 30, TOTAL: 8, CUE: { slam: 1.4, bang: 3.5 } });
  assert.deepEqual(frames, [1.267, 1.4, 1.6, 3.367, 3.5, 3.7]);
  assert.deepEqual(frames.map((x) => Math.round(x * 30)), [38, 42, 48, 101, 105, 111]);   // cue frame minus 4, the cue frame, plus 6
  assert.deepEqual(legend.get(1267), ["slam (before)"]);
  assert.deepEqual(legend.get(3700), ["bang (after)"]);
});

test("cueFrames keeps frames inside the video and joins cues that share a frame", async () => {
  const { cueFrames } = await lib("stills.mjs");
  const { frames, legend } = cueFrames({ fps: 30, TOTAL: 4, CUE: { first: 0.05, last: 4 } });
  assert.ok(frames.every((x) => x >= 0 && x <= 3.95 + 1e-9), frames.join(","));
  assert.ok([...legend.values()].some((v) => v.length > 1), "0.0 s holds both the before and the hit of the first cue");
});

test("legendText lists the number, the time, the frame and the cue", async () => {
  const { legendText } = await lib("stills.mjs");
  const text = legendText([1.267, 1.4, 2], new Map([[1267, ["slam (before)"]], [1400, ["slam"]]]), 30);
  assert.equal(text, "  1. 1.267 s  frame 38  slam (before)\n  2. 1.400 s  frame 42  slam\n  3. 2.000 s  frame 60\n");
});

test("rangeFrames steps every --every seconds and refuses nonsense", async () => {
  const { rangeFrames } = await lib("stills.mjs");
  assert.deepEqual(rangeFrames("1:2", undefined, 8), [1, 1.25, 1.5, 1.75, 2]);
  assert.deepEqual(rangeFrames("0.5:1.1", "0.3", 8), [0.5, 0.8, 1.1]);
  assert.throws(() => rangeFrames("2:1", undefined, 8), /usage: studio stills/);
  assert.throws(() => rangeFrames("1", undefined, 8), /usage: studio stills/);
  assert.throws(() => rangeFrames("1:2", "0", 8), /usage/);
  assert.throws(() => rangeFrames("1:2", true, 8), /usage/);
  assert.throws(() => rangeFrames("1:9", undefined, 8), /ends after the video/);
  assert.throws(() => rangeFrames("0:8", "0.01", 8), /larger --every/);
});

// ---- compose: CUE in the page
test("unknownCues finds a misspelt name in either form and ignores comments", async () => {
  const { unknownCues } = await lib("compose.mjs");
  const cues = { slam: 1.4, bang: 3.5 };
  const page = (js) => `<html><body><script>${js}</script></body></html>`;
  assert.deepEqual(unknownCues(page("tl.set('#a', {}, CUE.slmm); tl.set('#b', {}, CUE.bang);"), cues), ["slmm"]);
  assert.deepEqual(unknownCues(page('tl.set("#a", {}, CUE["slmm"]); CUE . slam;'), cues), ["slmm"]);
  assert.deepEqual(unknownCues(page("// CUE.nope\n/* CUE.nope2 */ CUE.slam"), cues), []);
  assert.deepEqual(unknownCues(page("x.CUE.nope; myCUE.nope"), cues), [], "a property of something else is not the cue sheet");
  assert.deepEqual(unknownCues(page("CUE.a; CUE.a; CUE.b"), {}), ["a", "b"]);
});

test("typedCueTimes names the cue whose time is typed as a number, and only that", async () => {
  const { typedCueTimes } = await lib("compose.mjs");
  const cues = { slam: 1.4, bang: 3.5 };
  const page = (js) => `<script>${js}</script>`;
  assert.deepEqual(typedCueTimes(page("tl.to('#a', {x: 1}, 3.5);"), cues), ["bang (3.5)"]);
  assert.deepEqual(typedCueTimes(page("tl.to('#a', {x: 1}, 1.40); tl.to('#b', {}, 3.50)"), cues), ["slam (1.4)", "bang (3.5)"]);
  assert.deepEqual(typedCueTimes(page("tl.to('#a', {x: 1}, CUE.slam); // 3.5"), cues), []);
  assert.deepEqual(typedCueTimes(page("x = 13.5; y = 3.55"), cues), [], "a longer number is another number");
  assert.deepEqual(typedCueTimes(page("x = 3.5"), {}), []);
});

// ---- check: one sync line per cue
test("syncRow passes within 1.5 frames and fails past it", async () => {
  const { syncRow } = await lib("check.mjs");
  const ok = syncRow({ name: "bang", t: 3.5, d: 0.045 }, 30), bad = syncRow({ name: "boom", t: 6.2, d: 0.1 }, 30);
  assert.equal(ok.name, "sync bang");
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
  assert.equal(syncRow({ name: "x", t: 1, d: -0.05 }, 30).ok, true, "exactly 1.5 frames early is still inside");
  assert.equal(syncRow({ name: "x", t: 1, d: -0.06 }, 30).ok, false);
  assert.equal(syncRow({ name: "x", t: 1, d: 0.04 }, 60).ok, false, "at 60 fps the limit is 25 ms");
  const none = syncRow({ name: "x", t: 1, d: null, onset: null }, 30);
  assert.equal(none.ok, false);
  assert.match(none.info, /no sound near 1 s/);
  const swell = syncRow({ name: "x", t: 3.5, d: -0.15, onset: 3.35, sharp: false }, 30);
  assert.equal(swell.ok, false);
  assert.equal(swell.info, "3.50 s: no sharp onset within ±0.15 s of the cue (the sound only swells there)");
  assert.doesNotMatch(swell.info, /-0\.150/, "the window edge is not printed as a measurement");
  assert.equal(syncRow({ name: "x", t: 3.5, d: 0.005, sharp: true }, 30).ok, true);
  assert.match(bad.info, /audio \+0\.100 s \(max ±1\.5 frames = 0\.050 s\)/);
});

// ---- CUE in the page (lib.js)
function startWith(cue) {
  const window = { TIMING: { T: { s1: { start: 0, end: 4, vo: 0, vo_end: 4, dur: 4 } }, EV: {}, CUE: cue, TOTAL: 4 } };
  const tl = { to() { return tl; }, set() { return tl; } };
  const context = { window, gsap: { timeline: () => tl, set() {}, to() {} }, document: { getElementById: () => null } };
  vm.runInNewContext(fs.readFileSync(path.join(SKILL, "template", "lib.js"), "utf8"), context);
  return window.SS.start({ cuts: "hard" });
}
test("CUE in the page reads a cue and throws on a misspelt name", () => {
  const { CUE } = startWith({ slam: 1.4, bang: 3.5 });
  assert.equal(CUE.slam, 1.4);
  assert.equal(CUE.bang, 3.5);
  assert.throws(() => CUE.slmm, /unknown cue slmm \(add it to project\.json cues, then studio audio\)/);
  assert.doesNotThrow(() => JSON.stringify(CUE));
});
test("CUE exists and throws when the project has no cues at all", () => {
  const { CUE } = startWith(undefined);
  assert.throws(() => CUE.anything, /unknown cue anything/);
});

// ---- with the tool home: the commands end to end
test("studio score writes a deterministic score with a hit on every cue; audio turns the cues into timing CUE and SYNC",
  { skip: SKIP, timeout: 120000 }, () => {
    const dir = filmProject({ cues: { slam: 1.4, bang: { t: 3.5, sync: true }, boom: { t: 6.2, sync: true, sfx: "pop" } } });
    const wav = path.join(dir, "src", "assets", "score.wav"), hash = () => crypto.createHash("sha256").update(fs.readFileSync(wav)).digest("hex");
    const r1 = studio("score", dir);
    assert.equal(r1.status, 0, r1.stderr);
    const first = hash();
    assert.equal(studio("score", dir).status, 0);
    assert.equal(hash(), first, "two runs give the same file");
    const proj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
    proj.music = { file: "src/assets/score.wav", start: 0, gain_db: 0 };
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(proj));
    const a = studio("audio", dir);
    assert.equal(a.status, 0, a.stderr);
    const timing = JSON.parse(fs.readFileSync(path.join(dir, "timing.json"), "utf8"));
    assert.deepEqual(timing.CUE, { slam: 1.4, bang: 3.5, boom: 6.2 });
    assert.deepEqual(timing.SYNC, ["bang", "boom"]);
    assert.match(fs.readFileSync(path.join(dir, "timing.js"), "utf8"), /"CUE": \{"slam": 1\.4/);
  });

test("musicAfterScore sets the score as the music unless the project plays a user's song", async () => {
  const { musicAfterScore, SCORE_MUSIC } = await lib("score.mjs");
  for (const before of [undefined, "warm", "none", "calm", {}, null])
    assert.deepEqual(musicAfterScore({ music: before }), { music: SCORE_MUSIC, kind: "set" }, JSON.stringify(before));
  const song = { file: "src/assets/song.mp3", start: 47.3, gain_db: -3 };
  assert.deepEqual(musicAfterScore({ music: song }), { music: song, kind: "user" });
  const own = { file: "src/assets/score.wav", start: 5, gain_db: -2 };
  assert.deepEqual(musicAfterScore({ music: own }), { music: own, kind: "score" }, "a score already in use keeps its start and gain");
  assert.equal(musicAfterScore({ music: { file: "./src/assets/score.wav" } }).kind, "score");
});

test("studio score sets project.json music to the score and keeps the rest; a user's song is left alone",
  { skip: SKIP, timeout: 60000 }, () => {
    const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
    const dir = filmProject({ music: "warm", cues: { hit: { t: 3.5, sync: true } } }), before = read(dir);
    const r = studio("score", dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /set "music" in project\.json to \{"file":"src\/assets\/score\.wav","start":0,"gain_db":0\}/);
    assert.deepEqual(read(dir), { ...before, music: { file: "src/assets/score.wav", start: 0, gain_db: 0 } });
    assert.equal(fs.readFileSync(path.join(dir, "project.json"), "utf8"), JSON.stringify(read(dir), null, 2), "same 2 space indent");
    const again = studio("score", dir);
    assert.match(again.stdout, /already plays src\/assets\/score\.wav/);
    const song = { file: "src/assets/song.mp3", start: 47.3, gain_db: -3 }, mine = filmProject({ music: song, cues: { hit: 3.5 } });
    const kept = studio("score", mine);
    assert.equal(kept.status, 0, kept.stderr);
    assert.deepEqual(read(mine).music, song);
    assert.match(kept.stdout, /plays src\/assets\/song\.mp3 \(the user's own file\), so it was left as it is/);
    assert.ok(fs.existsSync(path.join(mine, "src", "assets", "score.wav")), "the score is still written");
  });

test("studio score without cues, and audio with a cue outside the video, say what to fix", { skip: SKIP, timeout: 60000 }, () => {
  const none = studio("score", filmProject());
  assert.equal(none.status, 1);
  assert.match(none.stderr, /nothing to score/);
  const dir = filmProject({ cues: { far: 99 } });
  const a = studio("audio", dir);
  assert.notEqual(a.status, 0);
  assert.match(a.stderr, /cue "far" at 99\.0 s is outside the video/);
});

test("studio compose stops on a misspelt CUE name and warns about a typed cue time", { skip: SKIP, timeout: 60000 }, () => {
  const dir = filmProject({ cues: { slam: 1.4 } });
  const script = (js) => `<!doctype html><html><head><script src="gsap.min.js"></script><script src="timing.js"></script><script src="lib.js"></script></head><body>
<div id="root" data-composition-id="main" data-width="{{W}}" data-height="{{H}}" data-fps="{{FPS}}" data-duration="{{TOTAL}}">
<div id="s1" class="scene clip" data-start="{{s1.start}}" data-duration="{{s1.dur}}" data-track-index="1"></div>
<div id="s2" class="scene clip" data-start="{{s2.start}}" data-duration="{{s2.dur}}" data-track-index="2"></div></div>
<script>(function(){const {tl, CUE} = SS.start({cuts: "hard"}); ${js} window.__timelines = {main: tl};})();</script></body></html>`;
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify({ T: { s1: { start: 0, vo: 0, vo_end: 4, end: 4, dur: 4 }, s2: { start: 4, vo: 4, vo_end: 8, end: 8, dur: 4 } }, EV: {}, CUE: { slam: 1.4 }, SYNC: [], TOTAL: 8, fps: 30, aspect: "9:16" }));
  fs.writeFileSync(path.join(dir, "timing.js"), "window.TIMING = " + fs.readFileSync(path.join(dir, "timing.json"), "utf8") + ";\n");
  fs.mkdirSync(path.join(dir, "audio"), { recursive: true }); fs.writeFileSync(path.join(dir, "audio", "mix.wav"), Buffer.alloc(44));
  fs.writeFileSync(path.join(dir, "src", "index.html"), script('tl.set("#s1", {opacity: 1}, CUE.slmm);'));
  const bad = studio("compose", dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /CUE\.slmm: no cue called "slmm" in project\.json "cues" \(cues: slam\)/);
  fs.writeFileSync(path.join(dir, "src", "index.html"), script('tl.set("#s1", {opacity: 1}, 1.4);'));
  const typed = studio("compose", dir);
  assert.equal(typed.status, 0, typed.stderr);
  assert.match(typed.stdout, /cue times typed as numbers in the page: slam \(1\.4\)/);
  fs.writeFileSync(path.join(dir, "src", "index.html"), script('tl.set("#s1", {opacity: 1}, CUE.slam);'));
  const good = studio("compose", dir);
  assert.equal(good.status, 0, good.stderr);
  assert.doesNotMatch(good.stdout, /typed as numbers/);
});


// ---- defects found by the verifier
test("cueRows refuses an unknown sfx and a sync that is not true or false", async () => {
  const { cueRows } = await lib("cues.mjs");
  const { rows, problems } = cueRows({ cues: { a: { t: 1, sfx: "boom" }, b: { t: 2, sync: "yes" }, c: { t: 3, sync: true, sfx: "whoosh" }, d: { t: 4, sfx: "" }, e: { t: 5, sync: null } } });
  assert.deepEqual(rows.map((r) => r.name), ["c", "d", "e"]);
  assert.deepEqual(problems, ['cue "a": unknown sfx "boom". Use one of pop, click, whoosh (or leave "sfx" out).',
    'cue "b": "sync" must be true or false, not "yes". Fix it in project.json "cues".']);
});

test("studio cues exits 1 on an unknown sfx or a text sync, naming the cue", () => {
  const sfx = studio("cues", filmProject({ cues: { slam: { t: 1.4, sfx: "boom" } } }));
  assert.equal(sfx.status, 1);
  assert.match(sfx.stderr, /cue "slam": unknown sfx "boom"\. Use one of pop, click, whoosh/);
  const sync = studio("cues", filmProject({ cues: { bang: { t: 3.5, sync: "yes" } } }));
  assert.equal(sync.status, 1);
  assert.match(sync.stderr, /cue "bang": "sync" must be true or false, not "yes"/);
});

test("a cue on the very end of the video belongs to the last scene and is not outside", async () => {
  const { cueRows, outsideProblems, videoLength } = await lib("cues.mjs");
  const proj = { scenes: [{ id: "s1", start: 0, end: 4 }, { id: "s2", start: 4, end: 8 }], cues: { end: 8, past: 8.5 } };
  const { rows } = cueRows(proj);
  assert.equal(rows.find((r) => r.name === "end").scene, "s2");
  assert.equal(rows.find((r) => r.name === "past").scene, null);
  assert.equal(videoLength(proj), 8);
  assert.deepEqual(outsideProblems(rows, 8), ['cue "past" at 8.5 s is outside the video (0 to 8.0 s). Move it in project.json "cues".']);
  assert.equal(videoLength({ scenes: [{ id: "s1", say: "x" }] }), null, "a narrated video is timed by the voice: nothing to compare with");
});

test("studio score stops on a cue outside the video with the same words as studio audio, and writes nothing", () => {
  const dir = filmProject({ cues: { far: 99, ok: 2 } });
  const r = studio("score", dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ERROR: cue "far" at 99\.0 s is outside the video \(0 to 8\.0 s\)\. Move it in project\.json "cues"\./);
  assert.equal(fs.existsSync(path.join(dir, "src", "assets", "score.wav")), false);
  const onTheEnd = studio("score", filmProject({ cues: { end: 8 } }));
  assert.doesNotMatch(onTheEnd.stderr, /outside the video/, "a cue at exactly the end is inside");
});

test("staleCues names every difference between project.json and timing.json", async () => {
  const { staleCues } = await lib("compose.mjs");
  const timing = { CUE: { slam: 1.4, bang: 3.5, gone: 7 }, SYNC: ["bang"] };
  assert.deepEqual(staleCues({ cues: { slam: 1.4, bang: { t: 3.5, sync: true }, gone: 7 } }, timing), []);
  assert.deepEqual(staleCues({ cues: { slam: 2, bang: { t: 3.5, sync: true }, gone: 7 } }, timing), ["cue slam is 2 s in project.json but 1.4 s in timing.json"]);
  assert.deepEqual(staleCues({ cues: { slam: 1.4, bang: 3.5, gone: 7 } }, timing), ['cue bang: "sync" changed']);
  assert.deepEqual(staleCues({ cues: { slam: 1.4, bang: { t: 3.5, sync: true }, fresh: 9 } }, timing), ["cue fresh is new", "cue gone was removed"]);
  assert.deepEqual(staleCues({}, { T: {} }), [], "no cues on either side agree");
});

test("compose, and so stills and render, stop when a cue changed since studio audio", { skip: SKIP, timeout: 60000 }, () => {
  const dir = filmProject({ cues: { slam: 2.0 } });
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify({ T: { s1: { start: 0, vo: 0, vo_end: 4, end: 4, dur: 4 }, s2: { start: 4, vo: 4, vo_end: 8, end: 8, dur: 4 } }, EV: {}, CUE: { slam: 1.4 }, SYNC: [], TOTAL: 8, fps: 30, aspect: "9:16" }));
  fs.writeFileSync(path.join(dir, "timing.js"), "window.TIMING = {};\n");
  fs.writeFileSync(path.join(dir, "src", "index.html"), "<html><body></body></html>");
  const r = studio("stills", dir, "--cues");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ERROR: the cue sheet changed since studio audio: run it again \(cue slam is 2 s in project\.json but 1\.4 s in timing\.json\)/);
});

test("rangeFrames keeps the end frame when it is off the step", async () => {
  const { rangeFrames } = await lib("stills.mjs");
  assert.deepEqual(rangeFrames("2:3.1", "0.4", 8), [2, 2.4, 2.8, 3.1]);
  assert.deepEqual(rangeFrames("0:1", "0.1", 8), [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], "ten steps of 0.1 reach 1 without a float miss");
  assert.deepEqual(rangeFrames("1:2", "0.5", 8), [1, 1.5, 2]);
});

test("cueFrames says in the legend when a frame was clamped to the video edge", async () => {
  const { cueFrames } = await lib("stills.mjs");
  const { frames, legend } = cueFrames({ fps: 30, TOTAL: 8, CUE: { first: 0.05, last: 7.95, mid: 4 } });
  assert.equal(frames[0], 0);
  assert.deepEqual(legend.get(0), ["first (before, clamped to the start of the video)"]);
  assert.ok(legend.get(7950).includes("last (after, clamped to the end of the video)"), JSON.stringify([...legend]));
  assert.deepEqual(legend.get(3867), ["mid (before)"], "a frame inside the video has no note");
});

test("no printed message in the scripts uses a dash between words", () => {
  const dir = path.join(SKILL, "scripts"), files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => e.isDirectory() ? (e.name !== "__pycache__" && e.name !== "doctor-fixtures" && walk(path.join(d, e.name))) : /\.(mjs|py)$/.test(e.name) && files.push(path.join(d, e.name)));
  walk(dir);
  const bad = files.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l]).filter(([, , l]) => /\s[\u2014\u2013]\s/.test(l)).map(([f, i]) => `${path.relative(ROOT, f)}:${i}`));
  assert.deepEqual(bad, []);
});
