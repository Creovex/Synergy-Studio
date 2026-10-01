// L12 test 7: a score of heavy hits still reaches -14 ±1 LUFS and a true peak of at most -1 dBTP after render.
// A 20 s wordless film whose score is a light groove with an impact, sting or roll every 1.5 s (12 hits), built with the
// CLI in a folder under tmp/: new, score, audio, render, check. Prints the audio step's lines (the limiter warning), the
// check lines, and the limiter's reduction measured here on audio/mix_raw.wav.
// Usage: node test/harness/l12-loud-hits.mjs [folder] [font-id]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STUDIO = path.join(ROOT, "skills", "synergy-studio", "scripts", "studio.mjs");
const DIR = path.resolve(process.argv[2] ?? path.join(ROOT, "tmp", "l12-loud-hits"));
const FONT = process.argv[3] || undefined;

const sounds = ["impact", "sting", "roll"];
export const SCORE = {
  tempo: { bpm: 120 }, anchors: [{ bar: 1, at: 0 }], seed: 3, reverb: "hall", ...(FONT ? { font: FONT } : {}),
  tracks: { drums: { kit: "standard", gain_db: -6, grids: [{ bars: "1-10", kick: "x.......x.......", chh: "x.x.x.x.x.x.x.x." }] },
            strings: { program: 48, gain_db: -10, chords: [1, 3, 5, 7, 9].map((b) => [`${b}:1`, ["Am", "F", "C", "G", "Am"][(b - 1) / 2], "2/1"]) } },
  hits: Array.from({ length: 12 }, (_, i) => ({ at: +(1.5 + i * 1.5).toFixed(2), sound: sounds[i % 3] })),
};
const PROJECT = { name: "l12-loud-hits", mode: "film", aspect: "16:9", fps: 30, length: 20, music: "none",
  scenes: [{ id: "s1", start: 0, end: 10 }, { id: "s2", start: 10, end: 20 }] };
const PAGE = `<!doctype html><html><head><meta charset="UTF-8"><script src="gsap.min.js"></script><script src="timing.js"></script>
<script src="words.js"></script><script src="lib.js"></script><link rel="stylesheet" href="looks.css">
<style>html,body{width:{{W}}px;height:{{H}}px}#root{width:{{W}}px;height:{{H}}px}</style></head><body>
<div id="root" data-look="midnight" data-composition-id="main" data-width="{{W}}" data-height="{{H}}" data-fps="{{FPS}}" data-duration="{{TOTAL}}">
<div id="s1" class="scene clip" data-start="{{s1.start}}" data-duration="{{s1.dur}}" data-track-index="1"><div id="a" class="abs h1" style="left:0;right:0;top:40%;text-align:center">Hits</div></div>
<div id="s2" class="scene clip" data-start="{{s2.start}}" data-duration="{{s2.dur}}" data-track-index="2"><div id="b" class="abs h1" style="left:0;right:0;top:40%;text-align:center">More hits</div></div>
<audio id="mix" src="audio/mix.wav" data-start="0" data-duration="{{TOTAL}}" data-track-index="99"></audio></div>
<script>(function () { const {tl, T, S, rise, finish} = SS.start({cuts: "hard"});
tl.to("#a", {scale: 1.1, duration: T.s1.dur, ease: "none"}, 0); tl.to("#b", {scale: 1.1, duration: T.s2.dur, ease: "none"}, S("s2", 0));
finish(); window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl; })();</script></body></html>
`;

function studio(...args) {
  const r = spawnSync(process.execPath, [STUDIO, ...args], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

fs.rmSync(DIR, { recursive: true, force: true });
let r = studio("new", DIR, "--mode", "film", "--aspect", "16:9", "--length", "20");
if (r.code !== 0) throw new Error(r.out);
fs.writeFileSync(path.join(DIR, "project.json"), `${JSON.stringify(PROJECT, null, 2)}\n`);
fs.writeFileSync(path.join(DIR, "src", "score.json"), `${JSON.stringify(SCORE, null, 1)}\n`);
fs.writeFileSync(path.join(DIR, "src", "index.html"), PAGE);
for (const step of ["score", "audio", "render", "check"]) {
  r = studio(step, DIR);
  const keep = r.out.split("\n").filter((l) => /tempo|notes on|!|WARNING|LUFS|PASS|FAIL|ERROR/.test(l));
  console.log(`studio ${step}: exit ${r.code}`);
  keep.forEach((l) => console.log(`    ${l.trim()}`));
  if (step !== "check" && r.code !== 0) { process.exitCode = 1; break; }
  if (step === "check") process.exitCode = r.code;
}
