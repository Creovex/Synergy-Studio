// synctest: picture against sound for the whole pipeline, once per computer (LITE.md 7.9 B).
// A black 10 s page flashes white for one frame at 2.0, 4.5 and 7.0 s while a 50 ms 1 kHz beep plays at the same times.
// It is built from a small project.json, timing and page in a temporary folder and goes through the normal compose and
// render path (the final loudness pass included). Flash times come from signalstats (frames with YAVG above 200), beep
// onsets from silencedetect (the ends of the silences). Pass: every flash and beep pair within one frame.
//
// Exit codes: 0 pass, 1 setup or usage error, 2 a pair is more than one frame apart, or a flash or beep is missing.
// A pass is stored in <home>/env.json as synctest {pass, mean_offset_ms, pairs, hyperframes_version, browser_version, date}
// (doctor reads the two versions to tell when the result is out of date). A failure removes any stored result, so doctor
// runs the test again. `--beep-offset <frames>` moves the beeps that many frames late (the falsifier; nothing is stored).
// `--keep` leaves the temporary project in place.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { H, die, say, run, env, parseArgs } from "./common.mjs";
import { updateEnv } from "./env.mjs";
import { withHeavyLock } from "./lock.mjs";
import { compose } from "./compose.mjs";
import { renderProject } from "./render.mjs";

export const USAGE = "synctest [--beep-offset <frames>]";

const FPS = 30, DURATION = 10, EVENTS = [2.0, 4.5, 7.0], BEEP_SECONDS = 0.05;
const FLASH_MIN_YAVG = 200, SILENCE_DB = -40;

const PAGE = `<!doctype html>
<html><head><meta charset="UTF-8">
<script src="gsap.min.js"></script>
<script src="timing.js"></script>
<script src="words.js"></script>
<script src="lib.js"></script>
<style>
html,body{width:{{W}}px;height:{{H}}px;margin:0;background:#000}
#root{position:relative;width:{{W}}px;height:{{H}}px;background:#000;overflow:hidden}
.scene{position:absolute;inset:0}
#flash{position:absolute;left:0;top:0;width:100%;height:100%;background:#fff;opacity:0}
</style></head>
<body>
<div id="root" data-composition-id="main" data-width="{{W}}" data-height="{{H}}" data-fps="{{FPS}}" data-duration="{{TOTAL}}">
  <div id="s1" class="scene clip" data-start="{{s1.start}}" data-duration="{{s1.dur}}" data-track-index="1">
    <div id="flash"></div>
  </div>
  <audio id="mix" src="audio/mix.wav" data-start="0" data-duration="{{TOTAL}}" data-track-index="99"></audio>
</div>
<script>
(function () {
  const {tl, finish} = SS.start({cuts: "hard"});
  // the flash is on for exactly the frame that starts at each time: from a quarter frame before it to half a frame after it
  ${EVENTS.map(t => `tl.to("#flash", {opacity: 1, duration: 0.001}, ${t} - 0.25 / {{FPS}}); tl.to("#flash", {opacity: 0, duration: 0.001}, ${t} + 0.5 / {{FPS}});`).join("\n  ")}
  finish();
  window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
})();
</script>
</body></html>
`;

function writeProject(e, dir, beepFrames) {
  fs.mkdirSync(path.join(dir, "src", "assets"), { recursive: true }); fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
  const project = { name: "synctest", mode: "film", aspect: "16:9", platform: "youtube", length: DURATION, fps: FPS, music: "none", voice_track: false,
                    scenes: [{ id: "s1", start: 0, end: DURATION }], transition_whoosh: false };
  const timing = { T: { s1: { start: 0, vo: 0, vo_end: DURATION, end: DURATION, dur: DURATION } }, EV: {}, TOTAL: DURATION, fps: FPS, aspect: "16:9", platform: "youtube", safe: null };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(timing, null, 2));
  fs.writeFileSync(path.join(dir, "timing.js"), "window.TIMING = " + JSON.stringify(timing) + ";\n");
  fs.writeFileSync(path.join(dir, "src", "index.html"), PAGE.replace(/\{\{FPS\}\}/g, String(FPS)).replace(/\$\{FPS\}/g, String(FPS)));
  const shift = beepFrames / FPS;
  const gate = EVENTS.map(t => `between(t,${(t + shift).toFixed(4)},${(t + shift + BEEP_SECONDS).toFixed(4)})`).join("+");
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=exprs='0.5*sin(2*PI*1000*t)*(${gate})':s=48000:d=${DURATION}:c=stereo`, "-c:a", "pcm_s16le", path.join(dir, "audio", "mix.wav")]);
}

// flash times and beep onsets (seconds) in a finished MP4
export function measure(e, mp4) {
  const stats = run(e.ffmpeg, ["-hide_banner", "-nostats", "-i", mp4, "-an", "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const flashes = []; let time = null;
  for (const line of stats.split("\n")) {
    const t = /pts_time:([\d.]+)/.exec(line); if (t) time = +t[1];
    const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line); if (y && time !== null && +y[1] > FLASH_MIN_YAVG) flashes.push(time);
  }
  const sil = run(e.ffmpeg, ["-hide_banner", "-nostats", "-i", mp4, "-vn", "-af", `silencedetect=noise=${SILENCE_DB}dB:d=0.1`, "-f", "null", "-"], { capture: true, soft: true }).stderr;
  // the last silence runs to the end of the file and also reports an end: that is not a beep
  const beeps = [...sil.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => +m[1]).filter(t => t < DURATION - 0.2);
  return { flashes, beeps };
}

export function judge({ flashes, beeps }) {
  if (flashes.length !== EVENTS.length || beeps.length !== EVENTS.length)
    return { pass: false, mean_offset_ms: null, pairs: [], reason: `found ${flashes.length} flash(es) and ${beeps.length} beep(s), expected ${EVENTS.length} of each` };
  const pairs = flashes.map((f, i) => ({ flash_s: +f.toFixed(3), beep_s: +beeps[i].toFixed(3), offset_ms: +((beeps[i] - f) * 1000).toFixed(1) }));
  const limit = 1000 / FPS, mean = pairs.reduce((a, p) => a + p.offset_ms, 0) / pairs.length;
  const pass = pairs.every(p => Math.abs(p.offset_ms) <= limit);
  return { pass, mean_offset_ms: +mean.toFixed(1), pairs, reason: pass ? "" : `a beep is more than one frame (${limit.toFixed(1)} ms) from its flash` };
}

const chromeVersionOf = file => (/(\d+\.\d+\.\d+\.\d+)/.exec(file ?? "") || [])[1] ?? null;      // the same rules doctor uses
const hyperframesVersionOf = e => { try { return JSON.parse(fs.readFileSync(path.join(e.node_modules, "hyperframes", "package.json"), "utf8")).version; } catch { return null; } };

async function synctest(beepFrames, keep) {
  const e = env();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synergy-synctest-"));
  try {
    writeProject(e, dir, beepFrames);
    say(`synctest: a black ${DURATION} s page with a one frame flash and a ${BEEP_SECONDS * 1000} ms beep at ${EVENTS.join(", ")} s${beepFrames ? `, the beeps ${beepFrames} frame(s) late` : ""}`);
    compose(dir);
    const fin = await renderProject(dir, false);
    const result = judge(measure(e, fin));
    result.pairs.forEach((p, i) => say(`  pair ${i + 1}: flash ${p.flash_s.toFixed(3)} s, beep ${p.beep_s.toFixed(3)} s, offset ${p.offset_ms > 0 ? "+" : ""}${p.offset_ms} ms`));
    if (!result.pass) {
      say(`FAIL  synctest: ${result.reason}. Look at HyperFrames' audio muxing, the --player-ready-timeout and the final loudnorm re-encode (run with --keep to inspect the project).`);
      if (!beepFrames) updateEnv({ synctest: undefined }, H);
      return 2;
    }
    say(`PASS  synctest: every flash and beep within one frame (${(1000 / FPS).toFixed(1)} ms), mean offset ${result.mean_offset_ms} ms`);
    if (beepFrames) say("  (--beep-offset was used: nothing stored in env.json)");
    else updateEnv({ synctest: { pass: true, mean_offset_ms: result.mean_offset_ms, pairs: result.pairs, hyperframes_version: hyperframesVersionOf(e), browser_version: chromeVersionOf(e.browser?.path), date: new Date().toISOString() } }, H);
    return 0;
  } finally {
    if (keep) say(`kept ${dir}`); else fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function main(argv) {
  const { flags } = parseArgs(argv);
  const beep = flags["beep-offset"] === undefined ? 0 : Number(flags["beep-offset"]);
  if (flags["beep-offset"] === true || !Number.isFinite(beep) || beep < 0) die("--beep-offset needs a number of frames, e.g. --beep-offset 3");
  return withHeavyLock(H, "synctest", () => synctest(beep, !!flags.keep), { log: say });
}
