import path from "node:path";
import { SKILL, ENVF, die, run, env, projDir, parseArgs } from "./common.mjs";

export const USAGE = "inspect <dir> [--from s] [--to s]";

// one picture of a stretch of the video: frames, scenes, the voice with the words heard, music, effects and the finished
// level on one time axis, with the warnings in red (inspect_video.py); the same timeline is printed as text
function inspect(dir, from, to) {
  const e = env(), d = projDir(dir);
  for (const [k, v] of [["from", from], ["to", to]]) if (v !== undefined && !Number.isFinite(Number(v))) die(`--${k} must be seconds, for example --${k} 2.5`);
  run(e.python, [path.join(SKILL, "scripts", "inspect_video.py"), ENVF, d, from ?? "", to ?? ""]);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  inspect(pos[0], flags.from, flags.to);
  return 0;
}
