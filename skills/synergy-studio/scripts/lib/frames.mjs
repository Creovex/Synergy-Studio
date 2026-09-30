import fs from "node:fs";
import path from "node:path";
import { die, say, run, env, needFile, parseArgs } from "./common.mjs";

export const USAGE = "frames <video> [--n 12] [--out file]";

// One contact sheet of a video: one JPEG, 4 tiles per row, tiles in time order. Shared by `frames` (n tiles spread over the
// video, each taken from the middle of its part) and `reference` (one tile every `every` seconds, starting at 0).
// Returns { duration, tiles }.
export function videoSheet(e, video, outFile, { every, n } = {}) {
  const duration = parseFloat(run(e.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { capture: true }).stdout);
  const tiles = every ? Math.ceil(duration / every) : n, cols = 4, rows = Math.ceil(tiles / cols);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  if (every) run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", video, "-vf", `fps=1/${every},scale=480:-2,tile=${cols}x${rows}`, "-frames:v", "1", outFile]);
  else {                                                                   // one seek per tile: the tile's time is exact
    const at = Array.from({ length: n }, (_, i) => +((i + 0.5) * duration / n).toFixed(3));
    const inputs = at.flatMap(t => ["-ss", String(t), "-t", "0.5", "-i", video]);
    const fc = at.map((_, i) => `[${i}:v]trim=end_frame=1,setpts=PTS-STARTPTS,scale=480:-2,setsar=1[v${i}];`).join("") + at.map((_, i) => `[v${i}]`).join("") + `concat=n=${n}:v=1:a=0,tile=${cols}x${rows}`;
    run(e.ffmpeg, ["-loglevel", "error", "-y", ...inputs, "-filter_complex", fc, "-frames:v", "1", outFile]);
  }
  return { duration, tiles };
}

function frames(video, nFlag, outFlag) {
  if (!video) die(`usage: studio ${USAGE}`); needFile(video, "video");
  const n = nFlag === undefined ? 12 : Number(nFlag);
  if (!Number.isInteger(n) || n < 1 || n > 60) die("--n needs a whole number of tiles from 1 to 60, e.g. --n 12");
  if (outFlag === true) die("--out needs a file name, e.g. --out sheet.jpg");
  const out = path.resolve(outFlag || `${path.basename(video, path.extname(video))}-frames.jpg`);
  const e = env(), r = videoSheet(e, path.resolve(video), out, { n });
  say(`frames: ${r.duration.toFixed(1)} s, ${n} tiles in time order (left to right, top to bottom)\n  LOOK at ${path.relative(process.cwd(), out)}`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  frames(pos[0], flags.n, flags.out);
  return 0;
}
