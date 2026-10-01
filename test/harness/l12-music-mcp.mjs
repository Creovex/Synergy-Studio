// L12 test 5: a film with a score file, built through MCP calls only (a script, not Claude), in the default homes.
// An 18 s 9:16 film: an Afrobeats groove whose bar 5 is anchored to the scene event s2.drop, an impact hit on the scene
// event s3.slam and a sting on the sync cue "logo". Steps: project_new, file writes, sounds, score, audio, stills, render,
// check. Pass: every check line PASS, and the impact's onset in the MP4 within 1 frame of s3.slam (measured here, not by
// the tool). Usage: node test/harness/l12-music-mcp.mjs [project-name] [font-id] [late]
// Falsifier: with "late" the impact is written 0.1 s (3 frames) after its event, and the run must FAIL.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { projectsHome, toolHome } from "../../skills/synergy-studio/scripts/lib/paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NAME = process.argv[2] ?? "l12-afrobeats-film";
const FONT = process.argv[3] || undefined;
const FPS = 30;
const calls = [];

export const PROJECT = {
  name: NAME, mode: "film", aspect: "9:16", platform: "tiktok", fps: FPS, length: 18, music: "warm",
  scenes: [{ id: "s1", start: 0, end: 6 }, { id: "s2", start: 6, end: 12 }, { id: "s3", start: 12, end: 18 }],
  events: { s2: { drop: 3.0 }, s3: { slam: 2.4 } },
  cues: { logo: { t: 16.5, sync: true } },
};

export const SCORE = {
  tempo: { bpm: 104, meter: "4/4", swing: 0.5, max_stretch: 0.06 },
  anchors: [{ bar: 1, at: 0 }, { bar: 5, at: "s2.drop" }],
  seed: 7, reverb: "room",
  tracks: {
    drums: { kit: "standard", gain_db: -2, grids: [
      { bars: "1-4", rim: "x..x..x.x..x..x.", shaker: "oxoxoxoxoxoxoxox" },
      { bars: "5-8", kick: "x.....x.x.......", rim: "x..x..x.x..x..x.", shaker: "oxoxoxoxoxoxoxox", conga_hi: "..x....x..x...o." }] },
    bass: { program: 33, gain_db: -3, notes: [5, 6, 7, 8].flatMap((b, i) => {
      const root = ["A1", "F1", "C2", "G1"][i];
      return [[`${b}:1`, root, "1/8"], [`${b}:2:3`, root, "1/16"], [`${b}:3`, root, "1/8"], [`${b}:4:3`, root, "1/16"]];
    }) },
    keys: { program: 4, octave: 4, gain_db: -6, pan: -0.3, rhythm: "..x...x...x...x.",
      chords: [1, 2, 3, 4, 5, 6, 7, 8].map((b) => [`${b}:1`, ["Am9", "Fmaj7", "C", "G"][(b - 1) % 4], "1/1"]) },
    lead: { program: 108, gain_db: -4, pan: 0.3, notes: [["5:1", "E5", "1/8", 110], ["5:2:3", "C5", "1/8"], ["5:4", "D5", "1/4"],
      ["7:1", "E5", "1/8", 110], ["7:2:3", "G5", "1/8"], ["7:4", "A5", "1/4"]] },
  },
  hits: [{ at: "s3.slam", sound: "impact" }, { at: "cue:logo", sound: "sting" }],
};
if (FONT) SCORE.font = FONT;
if (process.argv[4] === "late") SCORE.hits[0].offset = 0.1;

const PAGE = `<!doctype html>
<html><head><meta charset="UTF-8">
<script src="gsap.min.js"></script><script src="timing.js"></script><script src="words.js"></script><script src="lib.js"></script>
<link rel="stylesheet" href="looks.css">
<style>html,body{width:{{W}}px;height:{{H}}px}#root{width:{{W}}px;height:{{H}}px}
.disc{position:absolute;left:340px;top:760px;width:400px;height:400px;border-radius:50%;background:var(--accent)}</style></head>
<body><div id="root" data-look="bold" data-composition-id="main" data-width="{{W}}" data-height="{{H}}" data-fps="{{FPS}}" data-duration="{{TOTAL}}">
  <div id="s1" class="scene clip" data-start="{{s1.start}}" data-duration="{{s1.dur}}" data-track-index="1">
    <div id="s1t" class="abs h1" style="left:0;right:0;top:40%;text-align:center;font-size:120px">Feel the groove</div></div>
  <div id="s2" class="scene clip" data-start="{{s2.start}}" data-duration="{{s2.dur}}" data-track-index="2">
    <div id="s2t" class="abs h1" style="left:0;right:0;top:30%;text-align:center;font-size:120px">The drop</div>
    <div id="s2d" class="disc"></div></div>
  <div id="s3" class="scene clip" data-start="{{s3.start}}" data-duration="{{s3.dur}}" data-track-index="3">
    <div id="s3t" class="abs h1" style="left:0;right:0;top:40%;text-align:center;font-size:150px">SLAM</div>
    <div id="s3l" class="abs h1" style="left:0;right:0;top:60%;text-align:center;font-size:90px">Logo</div></div>
  <audio id="mix" src="audio/mix.wav" data-start="0" data-duration="{{TOTAL}}" data-track-index="99"></audio>
</div>
<script>(function () {
  const {tl, T, CUE, V, S, at, rise, pop, finish} = SS.start({cuts: "hard"});
  tl.to("#s1t", {scale: 1.06, duration: T.s1.dur, ease: "none"}, 0);
  rise("#s2t", S("s2", 0.2)); pop("#s2d", at("s2", "drop"));
  tl.set("#s3t", {scale: 0.2, opacity: 0}, 0); tl.to("#s3t", {scale: 1, opacity: 1, duration: 0.12, ease: "power4.out"}, at("s3", "slam") - 0.12);
  pop("#s3l", CUE.logo);
  finish();
  window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
})();</script></body></html>
`;

const client = new Client({ name: "l12-music", version: "1.0.0" });
const textOf = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const short = (s, n = 110) => (s.length > n ? `${s.slice(0, n).replace(/\n/g, " ")}...` : s.replace(/\n/g, " "));

async function call(name, args = {}) {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const line = `${String(calls.length + 1).padStart(2)}. ${name} ${short(JSON.stringify(args), 70)} -> ${result.isError ? "ERROR" : "ok"}, ${Date.now() - started} ms`;
  calls.push(line);
  console.log(line);
  return result;
}

async function job(name, args) {
  let r = await call(name, args);
  const id = r.structuredContent?.job_id;
  if (!id) return r;                                              // finished within the wait
  for (;;) {
    r = await call("studio_job_status", { job_id: id, wait_sec: 25 });
    if (["done", "failed"].includes(r.structuredContent.state)) return r;
  }
}

function must(ok, message) {
  if (!ok) { console.error(`FAIL: ${message}`); process.exitCode = 1; throw new Error(message); }
}

// Where the impact is in the MP4, by a matched filter: the impact recipe rendered alone on the same font (its first 50 ms)
// slid over the MP4's sound within ±0.15 s of the event; the best match is its offset. A "strongest rise" rule read the
// groove's rim at 14.344 s instead (-54 ms on the first run): under a groove the loudest rise is not always the hit.
// Also reported: the impact's own attack (first sample above -60 dBFS after its note) on that font.
function impactOffset(mp4, at, font) {
  const py = path.join(toolHome(), "venv", "bin", "python");
  const ffmpeg = path.join(toolHome(), "bin", "ffmpeg");
  const code = `
import subprocess, sys, numpy as np
sys.path.insert(0, sys.argv[4])
from score_file import compile_score
from instruments import render, find_font, default_soundfonts, SR
at = float(sys.argv[3])
raw = subprocess.run([sys.argv[1], "-loglevel", "error", "-i", sys.argv[2], "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.float32).astype(np.float64)
c = compile_score({"tempo": {"bpm": 104}, "reverb": "none", "hits": [{"at": at, "sound": "impact"}]}, {"T": {}, "EV": {}, "CUE": {}})
alone = render(c, find_font(default_soundfonts(), sys.argv[5] or None)[1], at + 1).mean(axis=1).astype(np.float64)
i0 = int(round(at * SR)); first = i0 + int(np.flatnonzero(np.abs(alone[i0:]) > 1e-3)[0])
tmpl = alone[i0: i0 + SR // 20]
best, lag_best = -2, 0
for lag in range(-int(0.15 * SR), int(0.15 * SR) + 1):
    seg = x[i0 + lag: i0 + lag + len(tmpl)]
    r = float(np.dot(seg, tmpl) / (np.linalg.norm(seg) * np.linalg.norm(tmpl) + 1e-12))
    if r > best: best, lag_best = r, lag
print(f"{lag_best / SR:.5f} {best:.3f} {(first - i0) / SR * 1000:.2f}")`;
  const r = spawnSync(py, ["-c", code, ffmpeg, mp4, String(at), path.join(ROOT, "skills", "synergy-studio", "scripts"), font ?? ""], { encoding: "utf8" });
  must(r.status === 0, `impact measure failed: ${r.stderr}`);
  const [lag, corr, attackMs] = r.stdout.trim().split(" ").map(Number);
  return { lag, corr, attackMs };
}

export async function main() {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "mcp", "server.mjs")], env: { ...process.env }, stderr: "inherit" }));
  try {
    must(!(await call("studio_project_new", { name: NAME, aspect: "9:16", platform: "tiktok", mode: "film", look: "bold" })).isError, "project_new");
    must(!(await call("studio_file_write", { name: NAME, path: "project.json", content: `${JSON.stringify(PROJECT, null, 2)}\n` })).isError, "project.json");
    must(!(await call("studio_file_write", { name: NAME, path: "src/score.json", content: `${JSON.stringify(SCORE, null, 1)}\n` })).isError, "score.json");
    must(!(await call("studio_file_write", { name: NAME, path: "src/index.html", content: PAGE })).isError, "index.html");
    const sounds = await call("studio_sounds", FONT ? { font: FONT } : {});
    must(!sounds.isError && /Fingered|Bass/i.test(textOf(sounds)), `sounds: ${short(textOf(sounds), 300)}`);
    const score = await job("studio_score", { name: NAME });
    console.log(textOf(score).split("\n").filter((l) => /score:|tempo|anchor|hit|notes/.test(l)).map((l) => `    ${l}`).join("\n"));
    must(!score.isError && /bar 5 at 9\.000000 s \(\+0\.00 samples\)/.test(textOf(score)), "score report: bar 5 on s2.drop");
    const audio = await job("studio_audio", { name: NAME });
    console.log(textOf(audio).split("\n").filter((l) => /replaces|LUFS|WARNING|!/.test(l)).map((l) => `    ${l}`).join("\n"));
    must(!audio.isError && /replaces the generated "warm" bed/.test(textOf(audio)), `audio: ${short(textOf(audio), 400)}`);
    const stills = await job("studio_stills", { name: NAME, cues: true });
    must(stills.structuredContent?.state === "done" && stills.content.some((c) => c.type === "image"), "stills returned the sheet");
    const render = await job("studio_render", { name: NAME });
    must(render.structuredContent?.state === "done", `render: ${short(textOf(render), 400)}`);
    const check = await job("studio_check", { name: NAME });
    const lines = textOf(check).split("\n").filter((l) => /^(PASS|FAIL|WARN)\b/.test(l.trim()));
    lines.forEach((l) => console.log(`    ${l.trim()}`));
    must(check.structuredContent?.state === "done" && lines.length > 0 && !lines.some((l) => l.trim().startsWith("FAIL")), "check: every line PASS");
    const mp4 = path.join(projectsHome(), NAME, "out", `${NAME}-9x16.mp4`);
    const slam = 12 + 2.4;
    const o = impactOffset(mp4, slam, FONT);
    const onset = slam + o.lag + o.attackMs / 1000;
    console.log(`impact: event s3.slam ${slam.toFixed(3)} s; in the MP4 the impact sits ${(o.lag * 1000).toFixed(2)} ms from its scheduled place (match ${o.corr}); `
      + `its own attack ${o.attackMs} ms, so its first audible sample is at ${onset.toFixed(4)} s, ${((onset - slam) * 1000).toFixed(1)} ms after the event; one frame is ${(1000 / FPS).toFixed(1)} ms`);
    must(o.corr >= 0.5, "the impact was found in the MP4 (match of at least 0.5)");
    must(onset >= slam - 0.0005 && onset - slam <= 1 / FPS, "the impact lands within one frame of its event, never early");
    console.log(`L12 test 5 PASS: ${calls.length} MCP calls`);
  } finally {
    await client.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
