import fs from "node:fs";
import path from "node:path";
import { say, die, projDir, parseArgs, readJSON } from "./common.mjs";
import { readProject } from "./voice.mjs";

export const USAGE = "cues <dir>";

export const CUE_SFX = ["pop", "click", "whoosh"];        // the built in effects a cue may name
const CLOSE_FRAMES = 3;                                   // cues nearer than this are a typo or a double

// the start and end of each scene in seconds: from timing.json when there is one (narrated scenes are timed by the voice),
// else from the scenes of project.json (film and footage give them in seconds)
export function sceneSpans(proj, timing) {
  if (timing && timing.T) return Object.entries(timing.T).map(([id, t]) => ({ id, start: t.start, end: t.end }));
  return (Array.isArray(proj.scenes) ? proj.scenes : []).filter(s => s && Number.isFinite(Number(s.start)) && Number.isFinite(Number(s.end)))
    .map(s => ({ id: s.id, start: Number(s.start), end: Number(s.end) }));
}

// the length of a film or footage project's video in seconds (the end of its last scene); null when the scenes carry no times
// (a narrated video is timed by the voice, so only timing.json knows)
export function videoLength(proj) {
  const ends = sceneSpans(proj, null).map(s => s.end);
  return ends.length ? Math.max(...ends) : null;
}
// a number the way Python prints a float (99 gives "99.0"): the cue messages read the same from audio and score
export const pyNum = x => Number.isInteger(x) ? x.toFixed(1) : String(x);
// cues placed outside the video, in the same words as studio audio
export function outsideProblems(rows, total) {
  return total === null ? [] : rows.filter(r => r.t > total).map(r => `cue "${r.name}" at ${pyNum(r.t)} s is outside the video (0 to ${pyNum(total)} s). Move it in project.json "cues".`);
}

// the cue sheet of a project.json object as rows in time order; `problems` lists cues that cannot be read
export function cueRows(proj, timing) {
  const fps = Number(proj.fps) > 0 ? Number(proj.fps) : 30, rows = [], problems = [];
  const sheet = proj.cues && typeof proj.cues === "object" && !Array.isArray(proj.cues) ? proj.cues : {};
  for (const [name, v] of Object.entries(sheet)) {
    const obj = v !== null && typeof v === "object" && !Array.isArray(v), raw = obj ? v.t : v, t = typeof raw === "number" ? raw : NaN;
    if (!Number.isFinite(t) || t < 0) { problems.push(`cue "${name}" needs a time in seconds: "${name}": 21.4 or "${name}": {"t": 21.4, "sync": true}`); continue; }
    if (obj && v.sync !== undefined && v.sync !== null && typeof v.sync !== "boolean") { problems.push(`cue "${name}": "sync" must be true or false, not ${JSON.stringify(v.sync)}. Fix it in project.json "cues".`); continue; }
    if (obj && v.sfx !== undefined && v.sfx !== null && v.sfx !== "" && !CUE_SFX.includes(v.sfx)) { problems.push(`cue "${name}": unknown sfx ${JSON.stringify(v.sfx)}. Use one of ${CUE_SFX.join(", ")} (or leave "sfx" out).`); continue; }
    rows.push({ name, t, sync: obj && v.sync === true, sfx: obj && typeof v.sfx === "string" && v.sfx ? v.sfx : null });
  }
  rows.sort((a, b) => a.t - b.t || a.name.localeCompare(b.name));
  const scenes = sceneSpans(proj, timing), end = scenes.length ? Math.max(...scenes.map(s => s.end)) : NaN;
  rows.forEach((r, i) => {
    const sc = scenes.find(s => r.t >= s.start && r.t < s.end) || (r.t === end ? scenes.find(s => s.end === end) : undefined);   // a cue on the very last frame time belongs to the last scene
    r.scene = sc ? sc.id : null;
    r.gap = i === 0 ? null : +(r.t - rows[i - 1].t).toFixed(3);
    r.close = r.gap !== null && r.gap < CLOSE_FRAMES / fps;
  });
  return { rows, problems, fps, scenes };
}

// one printed line per cue
export function cueLine(r) {
  const gap = r.gap === null ? "" : `+${r.gap.toFixed(2)}`;
  return `${r.t.toFixed(2).padStart(7)} s  ${(r.scene || "none").padEnd(4)} ${gap.padStart(6)}  ${r.name}${r.sync ? "  [sync]" : ""}${r.sfx ? `  [sfx ${r.sfx}]` : ""}${r.close ? `  ! under ${CLOSE_FRAMES} frames after the previous cue` : ""}`;
}

function cues(dir) {
  const d = projDir(dir), proj = readProject(d), tf = path.join(d, "timing.json");
  let timing = null; try { if (fs.existsSync(tf)) timing = readJSON(tf); } catch { /* the project.json scenes are used instead */ }
  const { rows, problems, scenes } = cueRows(proj, timing);
  if (problems.length) die(problems.join("\n"));
  if (!rows.length) die('no "cues" in project.json. Example: "cues": {"slam": 21.4, "bang": {"t": 30.6, "sync": true}}');
  for (const r of rows) say(cueLine(r));
  say(`${rows.length} cues, ${rows.filter(r => r.sync).length} checked for sync by studio check. The page reads CUE.<name>, the score C["<name>"].`);
  const late = rows.filter(r => !r.scene);
  if (scenes.length && late.length) say(`  ! no scene holds ${late.map(r => r.name).join(", ")} (scenes: ${scenes.map(s => `${s.id} ${s.start} to ${s.end} s`).join(", ")})`);
}

export async function main(argv) {
  const { pos } = parseArgs(argv);
  cues(pos[0]);
  return 0;
}
