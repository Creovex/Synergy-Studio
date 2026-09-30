import path from "node:path";
import { SKILL, die, run, env, needFile, projDir, parseArgs } from "./common.mjs";

export const USAGE = "beats <dir> <song> [--start s]";

function beats(dir, song, start) {
  const e = env(), d = projDir(dir); if (!song) die("usage: studio beats <dir> <song file> [--start seconds]"); needFile(song, "song");
  run(e.python, [path.join(SKILL, "scripts", "beats.py"), e.ffmpeg, d, path.resolve(song), start || ""]);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  beats(pos[0], pos[1], flags.start);
  return 0;
}
