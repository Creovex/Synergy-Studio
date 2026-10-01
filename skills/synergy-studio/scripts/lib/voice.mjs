import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SKILL, ENVF, die, say, run, env, readJSON, needNarrated, projDir, parseArgs } from "./common.mjs";
import { listenBack } from "./listen.mjs";

export const USAGE = "voice <dir> [--only s2,s4] [--no-listen]";

// the ten voices a project may use (LITE 7.4); a British voice starts with b and speaks en-gb
export const VOICES = ["af_heart", "af_bella", "af_nova", "af_sky", "am_michael", "am_adam", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"];
export const voiceProblem = (id, where) => VOICES.includes(id) ? null : `unknown voice ${JSON.stringify(id)} (${where}). Use one of: ${VOICES.join(", ")}`;
// first refused voice in a project.json object (project voice, then each scene's own), or null
export function projectVoiceProblem(proj) {
  if (proj.voice !== undefined) { const m = voiceProblem(proj.voice, "project voice"); if (m) return m; }
  for (const s of proj.scenes || []) if (s.voice !== undefined) { const m = voiceProblem(s.voice, `scene ${s.id}`); if (m) return m; }
  return null;
}

// project.json as an object, or a one line error naming the file and the parse error
export function readProject(d) {
  const f = path.join(d, "project.json");
  try { return readJSON(f); }
  catch (err) { die(`${f} is not valid JSON (${err.message.replace(/\s+/g, " ")}). Fix the file (a comma, quote or bracket is usually missing) and run the command again.`); }
}

// scene ids must be s1, s2, ... and unique (LITE 6); returns the problem or null
export function sceneIdProblem(proj) {
  const seen = new Set();
  for (const s of Array.isArray(proj.scenes) ? proj.scenes : []) {
    const id = s && s.id;
    if (typeof id !== "string" || !/^s\d+$/.test(id)) return `scene id ${JSON.stringify(id)} is not allowed. Scene ids look like s1, s2, s3: rename it in project.json.`;
    if (seen.has(id)) return `scene id "${id}" is used twice. Give every scene its own id (s1, s2, s3) in project.json.`;
    seen.add(id);
  }
  return null;
}

// speed must be a number in Kokoro's range 0.5 to 2.0 (error); outside 0.85 to 1.1 speech sounds odd (warning, from voice.py)
export function speedProblem(proj) {
  const check = (v, where) => (typeof v !== "number" || !Number.isFinite(v) || v < 0.5 || v > 2.0)
    ? `speed ${JSON.stringify(v)} (${where}) is outside 0.5 to 2.0. Set "speed" to a number between 0.85 and 1.1 in project.json.` : null;
  if (proj.speed !== undefined) { const m = check(proj.speed, "project"); if (m) return m; }
  for (const s of Array.isArray(proj.scenes) ? proj.scenes : []) if (s && s.speed !== undefined) { const m = check(s.speed, `scene ${s.id}`); if (m) return m; }
  return null;
}

// ---------------------------------------------------------------- voice / audio
function voice(dir, only) {
  const e = env(), d = projDir(dir), proj = readProject(d); needNarrated(d, "voice");
  if (only === true) die("--only needs scene ids, e.g. --only s2,s4");
  const bad = sceneIdProblem(proj) || projectVoiceProblem(proj) || speedProblem(proj); if (bad) die(bad);
  if (only) { const ids = proj.scenes.map(s => s.id), missing = String(only).split(",").filter(x => !ids.includes(x));
    if (missing.length) die(`--only: no scene ${missing.join(", ")} (scenes: ${ids.join(", ")})`); }
  // The voice engine can crash while Python shuts down, after every file was written. voice.py writes
  // audio/voice-done.json with this run's id as its last act; a failed exit is accepted only when that file names this run.
  const runId = crypto.randomUUID(), done = path.join(d, "audio", "voice-done.json");
  fs.rmSync(done, { force: true });
  const r = run(e.python, [path.join(SKILL, "scripts", "voice.py"), ENVF, d, only || ""], { soft: true, env: { SS_VOICE_RUN: runId } });
  if (r.status !== 0) {
    let finished = false; try { finished = readJSON(done).run === runId; } catch { finished = false; }
    if (!finished) die(r.error ? `voice.py failed to start: ${r.error.message}` : `voice.py stopped (exit ${r.status ?? r.signal}): see the message above`);
    say(`  note: the voice engine crashed while closing (${r.signal ?? `exit ${r.status}`}) after every file of this run was written; the narration is complete`);
  }
  return { e, d, ids: only ? String(only).split(",") : proj.scenes.map((s) => s.id) };
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  const { e, d, ids } = voice(pos[0], flags.only);
  if (!flags["no-listen"]) await listenBack(e, d, ids);                 // Whisper hears each line back (lib/listen.mjs)
  return 0;
}
