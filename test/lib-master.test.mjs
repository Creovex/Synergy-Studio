// lib/master.mjs: the loudness that corrects itself (gain searched through the limiter, measured until within the tolerance).
// The search and the helpers are pure and run anywhere; the file tests use the real ffmpeg of the tool home and are skipped without it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  LUFS_TARGET, LUFS_TOLERANCE, limiterReduction, masterChain, masterGain, measureFile, parseEbur128, searchGain,
} from "../skills/synergy-studio/scripts/lib/master.mjs";

const HOME = process.env.SYNERGY_STUDIO_HOME || (process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite") : path.join(os.homedir(), ".local", "share", "synergy-studio-lite"));
const ENV = (() => { try { return JSON.parse(fs.readFileSync(path.join(HOME, "env.json"), "utf8")); } catch { return null; } })();
const skipReal = ENV && fs.existsSync(ENV.ffmpeg) ? false : "the tool home is not installed";
const made = [];
test.after(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// a mono 16 bit WAV at 48 kHz from a sample function (seconds -> -1..1)
function wav(seconds, sample) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio master ")); made.push(dir);
  const n = Math.round(seconds * 48000), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(96000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(i / 48000))) * 32767), 44 + i * 2);
  const file = path.join(dir, "in.wav"); fs.writeFileSync(file, buf); return file;
}
const sine = (amp, hz = 220) => (t) => amp * Math.sin(2 * Math.PI * hz * t);
// a quiet pad with one sharp loud click per second: a very high crest factor
const peaky = (pad, click) => (t) => sine(pad)(t) + (t % 1 < 0.004 ? click * Math.sin(2 * Math.PI * 1500 * t) : 0);

// ---------------------------------------------------------------- pure helpers
test("searchGain converges on a limiter that eats part of every added dB", () => {
  const limited = (startI) => (gain) => startI + gain * 0.8;          // the limiter gives back a fifth of each dB
  const r = searchGain(-19, limited(-19));
  assert.ok(r.converged);
  assert.ok(Math.abs(r.I - LUFS_TARGET) <= LUFS_TOLERANCE);
  assert.ok(r.steps <= 4);
});

test("searchGain stops at the first try when the gain is already right", () => {
  const r = searchGain(-14.05, (gain) => -14.05 + gain);
  assert.equal(r.steps, 1);
  assert.ok(r.converged);
});

test("searchGain that cannot reach the target keeps its closest try and says it did not converge", () => {
  const r = searchGain(-30, (gain) => -30 + Math.min(gain, 5));        // the limiter stops the loudness rising past -25: out of reach
  assert.equal(r.converged, false);
  assert.equal(r.steps, 4);
  assert.ok(Number.isFinite(r.gain) && Number.isFinite(r.I));
  assert.ok(r.I > -30);                                                 // better than the start
});

test("searchGain does not jump wildly when the loudness does not rise with the gain", () => {
  const steps = [];
  searchGain(-22, (gain) => { steps.push(gain); return gain > 15 ? -27 : -22 + gain * 0.1; });   // flat, then a fall
  assert.ok(steps.every((g, i) => i === 0 || Math.abs(g - steps[i - 1]) <= 12.001), steps.join(", "));
});

test("searchGain with a measurement that fails falls back to no gain", () => {
  const r = searchGain(-20, () => NaN);
  assert.deepEqual({ gain: r.gain, converged: r.converged }, { gain: 0, converged: false });
});

test("limiterReduction reports how far the peaks are pulled down and is zero when nothing is limited", () => {
  assert.equal(limiterReduction(-30, 0, 0.7), 0);
  assert.ok(Math.abs(limiterReduction(-1, 10, 0.7) - (9 + 3.098)) < 0.01);
});

test("masterChain puts the trim first, then the gain, the oversampled limiter and the resample back", () => {
  const c = masterChain(2.345, 0.7, "apad,atrim=end=20,");
  assert.match(c, /^apad,atrim=end=20,volume=2\.35dB,aresample=192000,alimiter=limit=0\.7:.*,aresample=48000$/);
  assert.match(masterChain(-1, 0.84), /^volume=-1\.00dB,/);
});

test("parseEbur128 reads the last loudness and true peak, and gives null for a silent file", () => {
  const out = "  I:         -23.4 LUFS\n  ...\n  I:         -14.1 LUFS\n  Peak:       -3.2 dBFS\n  Peak:       -2.9 dBFS";
  assert.deepEqual(parseEbur128(out), { I: -14.1, TP: -2.9 });
  assert.deepEqual(parseEbur128("  I:         -70.0 LUFS\n  Peak:       -inf dBFS"), { I: -70, TP: null });
  assert.deepEqual(parseEbur128(""), { I: null, TP: null });
});

// ---------------------------------------------------------------- with the real ffmpeg
test("masterGain lands a quiet file on the target through the limiter", { skip: skipReal }, () => {
  const file = wav(8, sine(0.03));
  const r = masterGain(ENV, file, 0.7);
  assert.equal(r.silent, false);
  const after = measureFile(ENV, file, masterChain(r.gain, 0.7));
  assert.ok(Math.abs(after.I - LUFS_TARGET) <= LUFS_TOLERANCE, `${after.I} LUFS`);
  assert.ok(after.TP <= -1.5, `${after.TP} dBTP`);
  assert.equal(r.reduction, 0);
});

test("masterGain on a peaky file keeps the loudness on target and warns when the limiter takes more than 6 dB", { skip: skipReal }, () => {
  const file = wav(8, peaky(0.02, 0.9)), said = [];
  const r = masterGain(ENV, file, 0.7, { log: (line) => said.push(line) });
  assert.ok(r.reduction > 6, `reduction ${r.reduction}`);
  assert.ok(said.some((line) => /limiter takes \d+\.\d dB off the peaks/.test(line)), said.join("\n"));
  const after = measureFile(ENV, file, masterChain(r.gain, 0.7));
  assert.ok(Math.abs(after.I - LUFS_TARGET) <= LUFS_TOLERANCE, `${after.I} LUFS`);
});

test("masterGain does not warn on a file the limiter barely touches", { skip: skipReal }, () => {
  const said = [];
  masterGain(ENV, wav(6, sine(0.05)), 0.7, { log: (line) => said.push(line) });
  assert.deepEqual(said, []);
});

test("masterGain on a silent file reports silent instead of a gain", { skip: skipReal }, () => {
  const r = masterGain(ENV, wav(3, () => 0), 0.7);
  assert.equal(r.silent, true);
  assert.equal(r.gain, 0);
  assert.equal(r.reduction, 0);
});

test("masterGain with a trim measures the file as cut to the timeline", { skip: skipReal }, () => {
  const file = wav(6, (t) => (t < 3 ? sine(0.05)(t) : sine(0.4)(t)));   // a quiet half, then a loud half
  const untrimmed = masterGain(ENV, file, 0.7).gain;
  const trimmed = masterGain(ENV, file, 0.7, { trim: "apad,atrim=end=3," }).gain;
  assert.ok(trimmed > untrimmed + 3, `${trimmed} against ${untrimmed}`);   // the loud tail is cut off, so the quiet part needs more gain
});

// ---------------------------------------------------------------- peaky and silent sources
// a mono WAV: a pad at `padDb` dBFS with three 20 sample clicks near full scale (the crest factor follows from the pad)
const clicks = (padDb) => (t) => 10 ** (padDb / 20) * Math.sin(2 * Math.PI * 220 * t) + ([3, 6, 9].some((s) => t >= s && t < s + 20 / 48000) ? 0.9 : 0);

test("masterGain: peaky sources that can be mastered (crest 18 to 30 dB) are reachable", { skip: skipReal }, () => {
  for (const padDb of [-22, -29, -34]) {
    const r = masterGain(ENV, wav(12, clicks(padDb)), 0.83);
    assert.equal(r.reachable, true, `pad ${padDb} dB reached ${r.I} LUFS`);
    assert.ok(Math.abs(r.I - LUFS_TARGET) <= LUFS_TOLERANCE, `pad ${padDb} dB reached ${r.I} LUFS`);
  }
});

test("masterGain: a track the limiter keeps far from -14 is not reachable and logs no warning of its own", { skip: skipReal }, () => {
  const said = [], r = masterGain(ENV, wav(12, clicks(-90)), 0.83, { log: (line) => said.push(line) });
  assert.equal(r.silent, false);
  assert.equal(r.reachable, false, `reached ${r.I} LUFS`);
  assert.deepEqual(said, []);
});

test("the limiter warning names what the user can change and treats scripts/score.py as a Claude Code option", { skip: skipReal }, () => {
  const said = [];
  masterGain(ENV, wav(12, clicks(-30)), 0.83, { log: (line) => said.push(line) });
  const line = said.join("\n");
  assert.match(line, /less peaky track/);
  assert.match(line, /softer hits/);
  assert.match(line, /in Claude Code, .*scripts\/score\.py/);
  assert.doesNotMatch(line, /template\/score\.py/);
});

// ---------------------------------------------------------------- the audio and render commands on those sources
const STUDIO = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "skills", "synergy-studio", "scripts", "studio.mjs");
const studio = (args) => spawnSync(process.execPath, [STUDIO, ...args], { encoding: "utf8", env: { ...process.env, SYNERGY_STUDIO_HOME: HOME } });
const noStack = (text) => assert.doesNotMatch(text, /\n\s+at .*\(|node:internal|ENOENT|Error: /);
function film(music) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "studio master ")), "film"); made.push(path.dirname(dir));
  assert.equal(studio(["new", dir, "--mode", "film", "--length", "6"]).status, 0);
  const file = path.join(dir, "project.json"), proj = JSON.parse(fs.readFileSync(file, "utf8"));
  proj.events = {}; delete proj.cues; proj.music = music;
  fs.writeFileSync(file, JSON.stringify(proj));
  return dir;
}
const song = (dir, sample) => { fs.mkdirSync(path.join(dir, "src", "assets"), { recursive: true }); fs.copyFileSync(wav(6, sample), path.join(dir, "src", "assets", "m.wav")); };
const musicFile = { file: "src/assets/m.wav", start: 0, gain_db: 0 };

test("audio on a silent mix (music none, no effects) writes the mix as it is and says the video will be silent", { skip: skipReal }, () => {
  const dir = film("none"), r = studio(["audio", dir]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(path.join(dir, "audio", "mix.wav")));
  assert.match(r.stdout + r.stderr, /the mix is silent: the video will have no sound/);
  assert.equal(measureFile(ENV, path.join(dir, "audio", "mix.wav")).TP, null);       // still silent: no gain was applied
});

test("audio on music at -73 dBFS (below the loudness gate) is a silent mix too", { skip: skipReal }, () => {
  const dir = film(musicFile); song(dir, sine(10 ** (-73 / 20)));
  const r = studio(["audio", dir]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout + r.stderr, /the mix is silent/);
  assert.ok(fs.existsSync(path.join(dir, "audio", "mix.wav")));
});

test("audio on a track that is too peaky to master stops with a plain message and leaves no mix.wav, not even an old one", { skip: skipReal }, () => {
  const dir = film(musicFile); song(dir, sine(0.1));
  assert.equal(studio(["audio", dir]).status, 0);
  assert.ok(fs.existsSync(path.join(dir, "audio", "mix.wav")), "a good mix exists first");
  song(dir, clicks(-90));                                                               // now the project cannot be mastered
  const r = studio(["audio", dir]), text = r.stdout + r.stderr;
  assert.equal(r.status, 1);
  assert.match(text, /too peaky to master/);
  assert.match(text, /less peaky track/);
  assert.match(text, /softer/);
  assert.match(text, /gain_db/);
  assert.equal(fs.existsSync(path.join(dir, "audio", "mix.wav")), false);
  noStack(text);
});

test("render without audio/mix.wav stops with a plain message that names studio audio", { skip: skipReal }, () => {
  const dir = film("none"), r = studio(["render", dir]), text = r.stdout + r.stderr;
  assert.equal(r.status, 1);
  assert.match(text, /audio\/mix\.wav is missing: run studio audio/);
  noStack(text);
});
