import path from "node:path";
import { say, readJSON, needNarrated, projDir, parseArgs } from "./common.mjs";

export const USAGE = "budget <dir>";

// ---------------------------------------------------------------- budget / say
function budget(dir) {
  const d = projDir(dir); needNarrated(d, "budget"); const p = readJSON(path.join(d, "project.json")), n = p.scenes.length, L = +(p.length || 30);
  const DEF = { lead: 0.9, pre: 0.6, post: 1.5, tail: 2.5 }, g = k => (p[k] ?? DEF[k]),   // the same defaults as audio.py
        pauses = g("lead") + g("tail") + p.scenes.reduce((a, s, i) => a + (i ? (s.pre ?? g("pre")) : 0) + (s.post ?? g("post")) + (s.hold || 0), 0);
  const narr = L - pauses, wps = 2.8 * (p.speed || 0.95) / 0.95;
  say(`target ${L} s = pauses ${pauses.toFixed(1)} s (lead ${g("lead")}, pre ${g("pre")} and post ${g("post")} per scene, tail ${g("tail")}) + narration ${narr.toFixed(1)} s`);
  say(`→ about ${Math.round(narr * wps)} words in total at speed ${p.speed || 0.95}, about ${Math.round(narr * wps / n)} per scene for ${n} scenes`);
  if (narr < n * 2) say("  too little narration time: use fewer scenes, shorter pauses, or a longer video");
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  budget(pos[0]);
  return 0;
}
