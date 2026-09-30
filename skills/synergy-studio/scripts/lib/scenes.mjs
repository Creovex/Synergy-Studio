import fs from "node:fs";
import path from "node:path";
import { die, say, run, env, needProjectFile, hasStream, numberFlag, projDir, parseArgs } from "./common.mjs";

export const USAGE = "scenes <dir> <clip> [--threshold 0.3]";

function scenes(dir, clip, flags) {
  const e = env(), d = projDir(dir); if (!clip) die("usage: studio scenes <dir> <clip> [--threshold 0.3]"); const given = clip; clip = needProjectFile(d, clip, "clip");
  const th = numberFlag(flags, "threshold", 0.3, n => n > 0 && n < 1, "a number between 0 and 1, e.g. --threshold 0.3");
  if (!hasStream(e, clip, "v")) die(`${clip} has no picture (it is not a video file), so there are no shot changes to find`);
  const r = run(e.ffmpeg, ["-hide_banner", "-i", clip, "-vf", `select='gt(scene,${th})',showinfo`, "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const cuts = [...r.matchAll(/pts_time:([\d.]+)/g)].map(m => +(+m[1]).toFixed(2));
  fs.writeFileSync(path.join(d, `scenes-${path.basename(clip).replace(/\.\w+$/, "")}.json`), JSON.stringify({ clip: given, threshold: th, cuts }, null, 1));
  say(cuts.length ? `${cuts.length} shot change${cuts.length === 1 ? "" : "s"}: ${cuts.join(", ")}` : `no shot changes found at threshold ${th} (one continuous shot; a lower --threshold such as 0.15 finds softer cuts)`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  scenes(pos[0], pos[1], flags);
  return 0;
}
