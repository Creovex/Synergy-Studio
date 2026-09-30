import fs from "node:fs";
import path from "node:path";
import { die, say, run, env, needFile, projDir, parseArgs } from "./common.mjs";
import { videoSheet } from "./frames.mjs";

export const USAGE = "reference <dir> <video> [--every 2]";

// ---------------------------------------------------------------- reference
// a reference video from the user → reference/sheet.jpg (one frame every N s) + reference/cuts.json (shot changes)
function reference(dir, video, every) {
  const e = env(), d = projDir(dir), N = parseFloat(every || 2);
  if (!video) die("usage: studio reference <dir> <video> [--every 2]"); needFile(video, "video");
  const out = path.join(d, "reference"); fs.mkdirSync(out, { recursive: true });
  const dur = videoSheet(e, video, path.join(out, "sheet.jpg"), { every: N }).duration;
  const log = run(e.ffmpeg, ["-hide_banner", "-i", video, "-vf", "select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const cuts = [...log.matchAll(/pts_time:([\d.]+)/g)].map(m => +(+m[1]).toFixed(2));
  fs.writeFileSync(path.join(out, "cuts.json"), JSON.stringify({ duration: +dur.toFixed(2), cuts }, null, 1));
  say(`reference: ${dur.toFixed(1)} s, ${cuts.length} cuts (average shot ${(dur / (cuts.length + 1)).toFixed(1)} s)\n  LOOK at ${path.relative(process.cwd(), path.join(out, "sheet.jpg"))} and write the style card in brief.md (references/cinema.md §1)`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  reference(pos[0], pos[1], flags.every);
  return 0;
}
