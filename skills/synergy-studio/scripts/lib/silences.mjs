import fs from "node:fs";
import path from "node:path";
import { die, say, run, env, needFile, projDir, parseArgs } from "./common.mjs";

export const USAGE = "silences <dir> <clip> [--db -32 --min 0.4]";

// ---------------------------------------------------------------- silences / scenes (find cut points in footage)
function silences(dir, clip, flags) {
  const e = env(), d = projDir(dir); if (!clip) die("usage: studio silences <dir> <clip> [--db -32] [--min 0.4]");
  needFile(clip, "clip"); const db = flags.db || -32, min = flags.min || 0.4;
  const r = run(e.ffmpeg, ["-hide_banner", "-i", path.resolve(clip), "-af", `silencedetect=noise=${db}dB:d=${min}`, "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const st = [...r.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]), en = [...r.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
  const dur = +(r.match(/Duration: (\d+):(\d+):([\d.]+)/) || [0, 0, 0, 0]).slice(1).reduce((a, x, i) => a + x * [3600, 60, 1][i], 0);
  const gaps = st.map((s, i) => ({ start: +s.toFixed(2), end: +(en[i] ?? dur).toFixed(2) }));
  // speech = the complement of the silences; each piece is a candidate "clip" for project.json edit.clips (0.12 s padding)
  const speech = []; let t = 0;
  for (const g of gaps) { if (g.start - t > 0.2) speech.push({ in: +Math.max(0, t - 0.12).toFixed(2), out: +Math.min(dur, g.start + 0.12).toFixed(2) }); t = g.end; }
  if (dur - t > 0.2) speech.push({ in: +Math.max(0, t - 0.12).toFixed(2), out: +dur.toFixed(2) });
  const out = { clip, duration: +dur.toFixed(2), silences: gaps, speech };
  fs.writeFileSync(path.join(d, `silences-${path.basename(clip).replace(/\.\w+$/, "")}.json`), JSON.stringify(out, null, 1));
  say(`${gaps.length} pauses ≥ ${min} s; ${speech.length} speech pieces (saved as silences-*.json; paste the pieces you keep into edit.clips)`);
  speech.forEach(p => say(`  speech ${p.in}–${p.out} s`));
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  silences(pos[0], pos[1], flags);
  return 0;
}
