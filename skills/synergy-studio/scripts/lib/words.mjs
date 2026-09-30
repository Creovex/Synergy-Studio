import fs from "node:fs";
import path from "node:path";
import { die, say, readJSON, projDir, parseArgs } from "./common.mjs";

export const USAGE = "words <dir>";

// narrated videos: word timings estimated from the script (character-proportional inside each line)
function words(dir) {
  const d = projDir(dir), proj = readJSON(path.join(d, "project.json"));
  if ((proj.mode || "narrated") !== "narrated") die(`words estimates timings from the narration; this is a ${proj.mode} project (use studio transcribe for footage). transcript.json was not touched.`);
  if (!fs.existsSync(path.join(d, "timing.json"))) die(`no timing.json yet: run studio audio ${dir} first (it times the scenes)`);
  const timing = readJSON(path.join(d, "timing.json"));
  const out = [];
  for (const s of proj.scenes) { const t = timing.T[s.id]; const ws = String(s.say || "").split(/\s+/).filter(Boolean); if (!ws.length) continue;
    const tot = ws.reduce((a, w) => a + w.length + 1, 0); let c = t.vo;
    ws.forEach(w => { const dur = (t.vo_end - t.vo) * (w.length + 1) / tot; out.push({ text: w, start: +c.toFixed(3), end: +(c + dur).toFixed(3) }); c += dur; }); }
  fs.writeFileSync(path.join(d, "transcript.json"), JSON.stringify(out, null, 1));
  say(`transcript.json: ${out.length} words (estimated timing, ±0.25 s)`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  words(pos[0]);
  return 0;
}
