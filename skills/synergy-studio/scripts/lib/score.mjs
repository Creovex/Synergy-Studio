import fs from "node:fs";
import path from "node:path";
import { SKILL, say, die, run, env, projDir, parseArgs } from "./common.mjs";
import { readProject } from "./voice.mjs";
import { cueRows, videoLength, outsideProblems } from "./cues.mjs";

export const USAGE = "score <dir>";

export const SCORE_FILE = "src/assets/score.wav";
export const SCORE_MUSIC = { file: SCORE_FILE, start: 0, gain_db: 0 };

// project.json "music" after a score run. kind "set": the score is now the music (a mood such as "warm", "none" or nothing before);
// "score": it already played the score file (its start and gain stay); "user": the project plays a song of the user's, left alone
export function musicAfterScore(proj) {
  const m = proj.music;
  if (m && typeof m === "object" && !Array.isArray(m) && typeof m.file === "string")
    return { music: m, kind: path.posix.normalize(m.file.replace(/\\/g, "/")) === SCORE_FILE ? "score" : "user" };
  return { music: { ...SCORE_MUSIC }, kind: "set" };
}

// Runs the BUNDLED starter score (template/score.py) on the project's cue sheet: a soft bed and a placeholder hit on every
// cue, written to src/assets/score.wav. It never runs scripts/score.py from the project: the tools do not run code a model wrote.
function score(dir) {
  const d = projDir(dir), proj = readProject(d), { rows, problems } = cueRows(proj);
  if (problems.length) die(problems.join("\n"));
  if (!rows.length) die('no "cues" in project.json, so there is nothing to score. Example: "cues": {"slam": 21.4, "bang": {"t": 30.6, "sync": true}}');
  const outside = outsideProblems(rows, videoLength(proj)); if (outside.length) die(outside.join("\n"));
  const e = env(), out = path.join(d, SCORE_FILE); fs.mkdirSync(path.dirname(out), { recursive: true });
  run(e.python, [path.join(SKILL, "template", "score.py"), out, "--project", d]);
  say(`wrote ${SCORE_FILE}: a bed and a placeholder hit on each of the ${rows.length} cues.`);
  const { music, kind } = musicAfterScore(proj);
  if (kind === "set") {                                   // only the music key changes; the file keeps its indent and final newline
    const f = path.join(d, "project.json"), text = fs.readFileSync(f, "utf8");
    fs.writeFileSync(f, JSON.stringify({ ...proj, music }, null, 2) + (text.endsWith("\n") ? "\n" : ""));
    say(`set "music" in project.json to ${JSON.stringify(music)}; run studio audio ${dir} next. The hits are placeholders: for a real score use the user's track.`);
  } else if (kind === "score") say(`project.json "music" already plays ${SCORE_FILE}; run studio audio ${dir} next.`);
  else say(`project.json "music" plays ${music.file} (the user's own file), so it was left as it is. To hear the starter score set "music" to ${JSON.stringify(SCORE_MUSIC)}.`);
}

export async function main(argv) {
  const { pos } = parseArgs(argv);
  score(pos[0]);
  return 0;
}
