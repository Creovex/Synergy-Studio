import fs from "node:fs";
import path from "node:path";
import { readProject, sceneIdProblem } from "./voice.mjs";
import { SKILL, say, die, run, env, projDir, parseArgs } from "./common.mjs";

export const USAGE = "audio <dir>";

export const TARGET = { I: -14, TP: -1.6, LRA: 11 };   // TP sits 0.1 dB under the -1.5 limit: the resample to 48 kHz can add a hair

// loudnorm prints its measurement as one JSON object at the end of stderr
export function parseLoudnorm(stderr) {
  const m = String(stderr || "").match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]);
  const v = k => Number(j[k]);
  const out = { i: v("input_i"), tp: v("input_tp"), lra: v("input_lra"), thresh: v("input_thresh"), offset: v("target_offset") };
  return Object.values(out).every(Number.isFinite) ? out : null;
}

// second pass: the measured values make loudnorm apply one constant gain (linear=true), so the shape of the mix is kept
export function loudnormPass2(m) {
  return `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true:print_format=summary`;
}

export const MOODS = ["warm", "calm", "upbeat", "none"];

// project.json problems audio.py would hit later, as one line each; null when fine
export function audioProblem(proj, d) {
  const bad = sceneIdProblem(proj); if (bad) return bad;
  const m = proj.music;
  if (m !== undefined && !(typeof m === "string" && MOODS.includes(m)) && !(m && typeof m === "object" && !Array.isArray(m)))
    return `unknown music ${JSON.stringify(m)}. Set "music" to "warm", "calm", "upbeat", "none" or {"file": "src/assets/song.mp3", "start": 0, "gain_db": -3} in project.json.`;
  if (proj.mode === "footage" && proj.voice_track !== false && !fs.existsSync(path.join(d, "audio", "voice.wav")))
    return `audio/voice.wav is missing. Run studio cut ${d} first (or set "voice_track": false for a music only project).`;
  return null;
}

function audio(dir) {
  const e = env(), d = projDir(dir), raw = path.join(d, "audio", "mix_raw.wav");
  const bad = audioProblem(readProject(d), d); if (bad) die(bad);
  run(e.python, [path.join(SKILL, "scripts", "audio.py"), d, e.ffmpeg]);
  const p1 = run(e.ffmpeg, ["-hide_banner", "-nostats", "-i", raw, "-af", `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}:print_format=json`, "-f", "null", "-"], { capture: true });
  const m = parseLoudnorm(p1.stderr);
  if (!m) die("could not measure the loudness of audio/mix_raw.wav (silent mix?)");
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", raw, "-af", loudnormPass2(m), "-ar", "48000", path.join(d, "audio", "mix.wav")]);
  say("wrote timing.js and audio/mix.wav (-14 LUFS)");
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  audio(pos[0]);
  return 0;
}
