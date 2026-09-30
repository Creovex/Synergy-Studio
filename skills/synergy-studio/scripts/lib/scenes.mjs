import fs from "node:fs";
import path from "node:path";
import { die, say, run, env, needFile, projDir, parseArgs } from "./common.mjs";

export const USAGE = "scenes <dir> <clip> [--threshold 0.3]";

function scenes(dir, clip, flags) {
  const e = env(), d = projDir(dir); if (!clip) die("usage: studio scenes <dir> <clip> [--threshold 0.3]"); needFile(clip, "clip");
  const th = flags.threshold || 0.3;
  const r = run(e.ffmpeg, ["-hide_banner", "-i", path.resolve(clip), "-vf", `select='gt(scene,${th})',showinfo`, "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const cuts = [...r.matchAll(/pts_time:([\d.]+)/g)].map(m => +(+m[1]).toFixed(2));
  fs.writeFileSync(path.join(d, `scenes-${path.basename(clip).replace(/\.\w+$/, "")}.json`), JSON.stringify({ clip, threshold: th, cuts }, null, 1));
  say(`${cuts.length} shot changes: ${cuts.join(", ")}`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  scenes(pos[0], pos[1], flags);
  return 0;
}
