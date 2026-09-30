import path from "node:path";
import { SKILL, ENVF, die, run, env, readJSON, needNarrated, projDir, parseArgs } from "./common.mjs";

export const USAGE = "voice <dir> [--only s2,s4]";

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
  run(e.python, [path.join(SKILL, "scripts", "voice.py"), ENVF, d, only || ""]);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  voice(pos[0], flags.only);
  return 0;
}
